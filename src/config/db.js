import mongoose from "mongoose";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("db");

const connectDb = async () =>{
    try {
        const connection = await mongoose.connect(`${process.env.MONGO_DB}`);
        logger.info("Database Connected Successfully");
        return connection;
    } catch (error) {
        logger.error("Database connection failed:", error);
        process.exit(1);
    }
}

export default connectDb;