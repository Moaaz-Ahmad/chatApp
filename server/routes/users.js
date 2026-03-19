const { Router } = require("express");
const authenticate = require("../middleware/authenticate");
const { searchUsersByEmail } = require("../controllers/userController");

const router = Router();

router.use(authenticate);

// GET /users/search?email=<query>
// Returns up to 10 users whose email contains the query (excludes self).
router.get("/search", async (req, res) => {
  try {
    const { email } = req.query;
    if (!email || email.trim().length < 2) {
      return res.status(400).json({ error: "email query must be at least 2 characters" });
    }
    const users = await searchUsersByEmail(email.trim(), req.user.sub);
    res.json(users);
  } catch (err) {
    console.error("[GET /users/search]", err);
    res.status(500).json({ error: "Search failed" });
  }
});

module.exports = router;
