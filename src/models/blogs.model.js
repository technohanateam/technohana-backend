import mongoose from "mongoose";

const blogSchema = new mongoose.Schema({
    id : {
        type : Number
    },
    title : {
        type : String,
    },
    slug : {
        type : String
    },
    img : {
        type : String
    },
    author : {
        type : String
    },
    date : {
        type : String,
    },
    content : {
        type : String
    },
    category :{
        type : String
    }
})

export const Blogs = mongoose.model("Blogs",blogSchema);