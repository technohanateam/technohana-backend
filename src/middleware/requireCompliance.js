// Must run after authenticateInstructor, which attaches complianceStatus to req.instructor.
export const requireCompliance = (req, res, next) => {
  const status = req.instructor?.complianceStatus;
  if (!status?.ndaAccepted || !status?.quizPassed) {
    return res.status(403).json({ success: false, message: "Complete compliance onboarding to access this feature" });
  }
  next();
};
