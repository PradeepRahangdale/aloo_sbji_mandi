import mongoose from "mongoose";


const dbConnection = async () => {

    try {
        const connectionInstance = await mongoose.connect(process.env.MONGO_URI,{
            dbName:process.env.DB_NAME
        });
        console.log(`\nDb connected With Host: ${connectionInstance.connection.host}`);

    } catch (e) {
        console.log(e)
        process.exit(1)
    }
}


export { dbConnection }
