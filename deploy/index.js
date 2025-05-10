const express = require("express");
const dotenv = require("dotenv");
const axios = require("axios");
const cors = require("cors");
const connectToDatabase = require("./db"); // Import DB connection

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware to parse JSON
app.use(cors({
    origin: "*",  // Allow all origins
    methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
    allowedHeaders: ["Content-Type", "Authorization"]
}));
app.use(express.json());

// Load Azure CLU and QnA configuration
const qnaEndpoint = process.env.QNA_ENDPOINT || "https://airportfaq-language.cognitiveservices.azure.com";
const qnaProject = process.env.QNA_PROJECT_NAME || "AirportFAQ-KB";
const qnaDeployment = process.env.QNA_DEPLOYMENT_NAME || "production";
const qnaKey = process.env.QNA_ENDPOINT_KEY || "FfmAwlSRBWnNNH7VWMtXiCesf0kqq5W7IdZVvwk3FhI5etg51PscJQQJ99BBACYeBjFXJ3w3AAAaACOGFLbG";

const cluEndpoint = process.env.CLU_ENDPOINT || "https://airportfaq-language.cognitiveservices.azure.com";
const cluKey = process.env.CLU_API_KEY || "FfmAwlSRBWnNNH7VWMtXiCesf0kqq5W7IdZVvwk3FhI5etg51PscJQQJ99BBACYeBjFXJ3w3AAAaACOGFLbG";
const cluProject = process.env.CLU_PROJECT_NAME || "AirportFAQ-CLU";
const cluDeployment = process.env.CLU_DEPLOYMENT_NAME || "Airport_trained";


let dbPool;

// Establish DB connection before starting the server
async function startServer() {
    try {
        dbPool = await connectToDatabase();
        console.log("✅ Database connected successfully");

        // Start the server only after DB is connected
        app.listen(PORT, () => {
            console.log(`🚀 Server running on port ${PORT}`);
        });
    } catch (error) {
        console.error("❌ Failed to connect to the database:", error.message);
        process.exit(1); // Exit process if DB connection fails
    }
}

// API endpoint to receive messages
app.post("/api/messages", async (req, res) => {
    const { message } = req.body;

    if (!message) {
        return res.status(400).json({ error: "Message is required" });
    }

    console.log(`🔹 User Message: ${message}`);

    const cluResult = await getIntentFromCLU(message);

    if (!cluResult) {
        return res.json({ response: "I'm having trouble understanding your request. Please try again." });
    }

    console.log(`🔥 Detected Intent: ${cluResult.intent}`);
    console.log(`🔍 Extracted Entities:`, cluResult.entities);

    if (cluResult.flightNumber) {
        const flightResponse = await handleFlightInfo(cluResult.flightNumber);
        return res.json({ response: flightResponse });
    } else {
        switch (cluResult.intent) {
            case "FlightSchedule":
            case "FlightStatus":
            case "GetFlightInfo":
            case "FlightDelayStatus":
                return res.json({ response: "Please provide a flight number to retrieve details." });
            case "Greeting":
                return res.json({ response: "Hello! How can I assist you today?" });
            default:
                const qnaResponse = await handleQnA(message);
                return res.json({ response: qnaResponse });
        }
    }
});

// Function to analyze user input with CLU
async function getIntentFromCLU(text) {
    try {
        const response = await axios.post(
            `${cluEndpoint}/language/:analyze-conversations?api-version=2022-10-01-preview`,
            {
                kind: "Conversation",
                analysisInput: {
                    conversationItem: {
                        id: "1",
                        text,
                        modality: "text",
                        language: "en",
                        participantId: "user",
                    },
                },
                parameters: {
                    projectName: cluProject,
                    deploymentName: cluDeployment,
                    stringIndexType: "TextElement_V8",
                },
            },
            {
                headers: {
                    "Ocp-Apim-Subscription-Key": cluKey,
                    "Content-Type": "application/json",
                },
            }
        );

        const topIntent = response.data.result.prediction.topIntent;
        const entities = response.data.result.prediction.entities || [];

        let flightNumber = entities.find(e => e.category === "FlightNumber")?.text || null;
        if (flightNumber) {
            flightNumber = flightNumber.replace(/\s+/g, "");
        }

        return { intent: topIntent, entities, flightNumber };
    } catch (error) {
        console.error("❌ CLU Error:", error.response?.data || error.message);
        return null;
    }
}

// Function to fetch flight details from the database
async function handleFlightInfo(flightNumber) {
    try {
        console.log(`📚 Fetching flight info for: ${flightNumber}`);
        const flightData = await getFlightDetails(flightNumber);

        if (flightData) {
            return `✈️ Flight ${flightData.flight_number} to ${flightData.airport_code} is scheduled for ${flightData.scheduled_datetime_flight}. Status: ${flightData.flight_status}. Gate: ${flightData.GateNumber}.`;
        } else {
            return `Sorry, I couldn't find details for flight ${flightNumber}.`;
        }
    } catch (error) {
        console.error("❌ Flight Info Error:", error.message);
        return "I encountered an error retrieving flight information. Please try again later.";
    }
}

// Function to query the database for flight details
async function getFlightDetails(flightNumber) {
    try {
        const result = await dbPool
            .request()
            .input("flightNumber", flightNumber.replace(/\s+/g, ""))
            .query("SELECT TOP 1 * FROM Flights WHERE REPLACE(flight_number, ' ', '') = @flightNumber");

        return result.recordset.length > 0 ? result.recordset[0] : null;
    } catch (error) {
        console.error("❌ Database Query Error:", error.message);
        return null;
    }
}

// Function to handle QnA responses
async function handleQnA(question) {
    try {
        console.log(`📚 Querying QnA Maker for: ${question}`);
        const response = await axios.post(
            `${qnaEndpoint}/language/:query-knowledgebases?projectName=${qnaProject}&api-version=2021-10-01&deploymentName=${qnaDeployment}`,
            { question, top: 1 },
            {
                headers: {
                    "Ocp-Apim-Subscription-Key": qnaKey,
                    "Content-Type": "application/json",
                },
            }
        );

        return response.data.answers?.[0]?.answer || "I'm not sure how to answer that. Can you try rephrasing?";
    } catch (error) {
        console.error("❌ QnA Maker Error:", error.response?.data || error.message);
        return "Sorry, I'm having trouble retrieving an answer right now.";
    }
}

// Start the server after establishing DB connection
startServer();
