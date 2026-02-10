import jwt from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config({
    path : "../../.env"
});

const JWT_SECRET = process.env.JWT_SECRET;

export const generateToken = (user) => {
    const payload = {
        id : user._id,
        name : user.name,
        email : user.email,
        isKyc : user.isKyc,
    }

    return jwt.sign(payload,JWT_SECRET,{expiresIn : "24h"});
}


export const verifyToken = (token) => {
    try {
        return jwt.verify(token,JWT_SECRET);
    } catch (error) {
        console.error("Token verification failed:", error);
        return null;
    }
}