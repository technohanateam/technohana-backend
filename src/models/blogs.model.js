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
    },
    contentType: {
        type: String,
        enum: ["search-article", "authority-article", "linkable-asset", "research", "expert-article", "resource", "tool", "case-study"],
        default: "search-article"
    },
    valueScores: {
        content: { type: Number, min: 0, max: 100 },
        authority: { type: Number, min: 0, max: 100 },
        linkability: { type: Number, min: 0, max: 100 },
        business: { type: Number, min: 0, max: 100 },
        originality: { type: Number, min: 0, max: 100 },
        courseRelevance: { type: Number, min: 0, max: 100 }
    },
    valueScoreSource: {
        type: String,
        enum: ["admin", "ai-estimated"],
        default: "admin"
    },
    authorId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Author",
        default: null
    }
}, { timestamps: true });

blogSchema.index({ published: 1, scheduledAt: 1 });
blogSchema.index({ contentType: 1 });

export const Blogs = mongoose.model("Blogs", blogSchema);
