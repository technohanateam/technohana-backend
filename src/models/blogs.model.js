import mongoose from "mongoose";

const blogSchema = new mongoose.Schema({
    id : {
        type : Number
    },
    title : {
        type : String,
        required: true,
    },
    slug : {
        type : String,
        unique: true,
        sparse: true,
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
    },
    sources: {
        type: [{ title: String, url: String, _id: false }],
        default: []
    },
    faqs: {
        type: [{ question: String, answer: String, _id: false }],
        default: []
    },
    published: {
        type: Boolean,
        default: false
    },
    scheduledAt: {
        type: Date,
        default: null
    }
}, { timestamps: true });

blogSchema.index({ published: 1, scheduledAt: 1 });

export const Blogs = mongoose.model("Blogs", blogSchema);
