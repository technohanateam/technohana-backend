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

        let user = await User.findOne({ googleId: profile.id });

        if (!user) {
          // No Google-linked account yet — check for an existing account with
          // this email (e.g. created via the enrollment form) and link it
          // instead of creating a disjoint duplicate. A user may have
          // multiple enrollment-only docs for the same email
          // (re-enrollments); prefer one that's already KYC-verified,
          // falling back to the most recent. A single atomic
          // findOneAndUpdate avoids a race under concurrent logins.
          user = await User.findOneAndUpdate(
            { email, googleId: { $exists: false } },
            { $set: { googleId: profile.id, ...(picture ? { picture } : {}) } },
            { sort: { isKyc: -1, createdAt: -1 }, new: true }
          );

          if (!user) {
            user = await User.create({
              googleId: profile.id,
              name: profile.displayName,
              email,
              ...(picture ? { picture } : {}),
            });
          }
        } else if (picture) {
          user.picture = picture;
          await user.save();
        }

        return done(null, user);
      } catch (error) {
        return done(error, false);
      }
    }
  )
);