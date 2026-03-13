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
    },
    excerpt: {
        type: String
    },
    metaTitle: {
        type: String
    },
    metaDescription: {
        type: String
    },
    focusKeyword: {
        type: String
    },
    tags: {
        type: [String],
        default: []
    },
    readTimeMin: {
        type: Number
    }
})

export const Blogs = mongoose.model("Blogs",blogSchema);