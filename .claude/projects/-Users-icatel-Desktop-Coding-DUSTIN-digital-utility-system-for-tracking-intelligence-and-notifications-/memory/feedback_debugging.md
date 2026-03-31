---
name: Debugging Feedback
description: Woody wants verbose debugging when troubleshooting deployment issues
type: feedback
---

When troubleshooting deployment/runtime issues, add more debugging logs proactively rather than iterating with minimal info.

**Why:** During Telegram connection debugging, Woody explicitly asked "do that - but also add more debugging" when I was about to restart without enough logging.

**How to apply:** When diagnosing production issues, add verbose logging on the first attempt rather than waiting for multiple failed iterations to add it incrementally.
