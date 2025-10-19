import mongoose from "mongoose";

const connectDb = async () =>{
    try {
        const connection = await mongoose.connect(`${process.env.MONGO_DB}`);
        console.log("Database Connected Successfully");
    } catch (error) {
        console.log("connection failed:",error);
        process.exit(1);
    }
}

export default connectDb;