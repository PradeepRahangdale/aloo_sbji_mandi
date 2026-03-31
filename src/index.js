import dotenv from "dotenv";
dotenv.config({
    path: "./.env"
})
import http from "http";
import { app } from "./app.js"
import { dbConnection } from "./db/dbConnection.js";
import { connectRedis } from "./config/redis.js";
import { initializeSocket, setIOInstance } from "./config/socket.js";
import { startBoliNotificationScheduler } from "./services/boliNotificationScheduler.js";
import { initializeFirebase } from "./services/fcm.service.js";

const Port = process.env.PORT || 8888;

// Create HTTP server
const server = http.createServer(app);

dbConnection()
    .then(async () => {
        // Initialize Redis
        await connectRedis();

        // Initialize Socket.IO
        const io = initializeSocket(server);
        setIOInstance(io);
        
        console.log("Socket.IO initialized successfully");

        // Initialize Firebase Admin SDK for FCM push notifications
        initializeFirebase();

        // Start Boli Notification Scheduler (sends reminders 3/2/1 days before boli)
        startBoliNotificationScheduler();

        server.listen(Port, '0.0.0.0', () => console.log(`Server is Running on Port ${Port} with ${process.pid}`));

    })




