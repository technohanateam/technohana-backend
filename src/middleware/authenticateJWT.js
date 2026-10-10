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

    // Instructor tokens are signed with the same JWT_SECRET as learner tokens and
    // are distinguished only by a `role` claim, which learner tokens never carry.
    // Without this check an instructor token authenticates as a learner, and any
    // route that resolves the enrollment by req.user.email would act on whichever
    // enrollment shares that address.
    if(userPayload.role){
        return res.status(403).json({message : "This token is not valid for learner routes"});
    }

    req.user = userPayload;
    next();
}
