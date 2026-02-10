import { verifyToken } from "../config/jwt.js"

export const authenticateJWT = (req,res,next) => {
    const authHeader = req.headers.authorization;

    if(!authHeader || !authHeader.startsWith("Bearer")){
        return res.status(401).json({message : "Accesss denied, no token provided"});
    }

    const token = authHeader.split(" ")[1];

    const userPayload = verifyToken(token);

    if(!userPayload){
        return res.status(401).json({message : "Invalid token"});
    }

    req.user = userPayload;
    next();
}
