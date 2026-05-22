Add a new API endpoint to technohana-backend.

Endpoint description: $ARGUMENTS

Steps:
1. Create or update controller at `src/controllers/[domain].controller.js` — named exports, async/await with try/catch
2. Create or update router at `src/routes/[domain].routes.js` — import controller, define Express routes
3. Register router in `src/index.js`:
   ```js
   import xRoutes from './routes/x.routes.js'  // .js extension is REQUIRED
   app.use('/api/x', xRoutes)
   ```
4. Add auth middleware:
   - User routes: `authenticateJWT`
   - Admin routes: `authenticateAdmin`
   - Public routes: document why explicitly
5. Response format:
   ```js
   // Success
   res.json({ success: true, data: ..., message: '...' })
   // Error
   res.status(400).json({ success: false, message: '...' })
   ```

Reference patterns:
- CRUD controller: `src/controllers/coupon.controller.js`
- Simple POST: `src/controllers/enrollment.controller.js`
- Payment flow: `src/index.js` Stripe/Razorpay routes (always call `computeQuote()` — never trust client price)
