# Neural Nexus Mobile — Final Release Candidate

## Included
- `mobile/`: Expo/React Native application.
- `backend/`: supplied Nexus backend with mobile-auth, push-token and mobile sync support.
- `reference/`: original platform HTML supplied in the conversation.

## Verified in this environment
- All 84 TypeScript/TSX source files parse without syntax errors.
- `app.json` and package JSON parse successfully.
- Backend mobile authentication runtime smoke test passed: one-time code, session creation, session resolution and revocation.
- The mobile SSE client consumes the backend's actual normalized `token` event.
- The mobile API contract matches routes present in the supplied backend source.
- The backend package install was attempted; the execution environment's private npm registry returned 404 for `@types/node`, so a full dependency-backed typecheck/native build could not be truthfully executed here.

## Production gate
The only remaining release verification is environment-dependent rather than missing source implementation:

```bash
cd backend
npm install
npm run typecheck
npm test
npm run build

cd ../mobile
npm install
npm run typecheck
npx expo-doctor
npx expo start
```

Then create Android/iOS Development Builds for Google OAuth, push notifications and native modules.

## Required backend secrets
Keep provider keys and the gateway key on the backend only. The mobile bundle must never contain them.

Required for mobile Google OAuth:

```env
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_MOBILE_REDIRECT_URI=https://YOUR-DOMAIN/api/auth/mobile/google/callback
MOBILE_APP_REDIRECT_URI=neuralnexus://auth/callback
```
