require("dotenv").config();
const sql = require("mssql");
const { ClientSecretCredential } = require("@azure/identity");

async function connectToDatabase() {
    try {
        // Authenticate with Azure AD
        const credential = new ClientSecretCredential(
            process.env.TENANT_ID || "c827032f-4f54-47be-9328-0d66377ad46c",
            process.env.CLIENT_ID || "4b042554-615a-43a1-b9a9-50f1bdc438d2",
            
        );

        // Get access token
        const tokenResponse = await credential.getToken("https://database.windows.net/.default");
        const accessToken = tokenResponse.token;

        // SQL Server connection configuration
        const config = {
            server: process.env.DB_SERVER || "myairportserver.database.windows.net",
            database: process.env.DB_DATABASE || "AirportDB",
            authentication: {
                type: "azure-active-directory-access-token",
                options: { token: accessToken }
            },
            options: {
                encrypt: true,
                trustServerCertificate: false
            }
        };

        // Connect to SQL Server
        const pool = await sql.connect(config);
        console.log("✅ Successfully connected to Azure SQL Database!");
        return pool;
    } catch (error) {
        console.error("❌ Database connection failed:", error.message);
        process.exit(1);
    }
}

// Export the function to be used in other files
module.exports = connectToDatabase;
