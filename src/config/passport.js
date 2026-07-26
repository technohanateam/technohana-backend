// config/passport.js

import passport from "passport";
import dotenv from "dotenv";
import { Strategy as GoogleStrategy } from "passport-google-oauth2"; // Use passport-google-oauth20
import { User } from "../models/user.model.js";

dotenv.config();

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: `${process.env.BASE_URL}/api/auth/google/callback`,
      scope: ['profile', 'email'] // Add scope here
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const picture = profile.photos?.[0]?.value || null;
        const email = profile.emails?.[0]?.value;
        if (!email) {
          return done(new Error("Google account did not return an email address"), false);
        }

        const user = await User.findOneAndUpdate(
          { googleId: profile.id },
          {
            $setOnInsert: {
              googleId: profile.id,
              name: profile.displayName,
              email,
            },
            ...(picture ? { $set: { picture } } : {}),
          },
          { upsert: true, new: true, runValidators: true }
        );

        return done(null, user);
      } catch (error) {
        return done(error, false);
      }
    }
  )
);