# EAS setup

This project is ready for EAS Build. The Expo account link still has to be
completed locally because `eas build:configure` is interactive.

## 1. Log in and link the project

```sh
npx eas-cli login
npm run eas:configure
```

After this step, EAS may add `extra.eas.projectId` to `app.json`.

## 2. Add Supabase environment variables to EAS

The local `.env` file is ignored and is not uploaded to EAS. Add these variables
in the Expo dashboard or with EAS env commands for each environment you build:

```txt
EXPO_PUBLIC_SUPABASE_URL
EXPO_PUBLIC_SUPABASE_ANON_KEY
EXPO_PUBLIC_GOOGLE_BOOKS_API_KEY
```

## 3. Build profiles

```sh
npm run eas:build:dev
npm run eas:build:preview:android
npm run eas:build:production
```

The preview Android profile creates an APK for quick installation. Production
uses app version auto-incrementing through EAS.

## 4. App identifiers

Current identifiers are placeholders:

```txt
iOS: com.honnoma.app
Android: com.honnoma.app
```

Change them before store submission if you want an account-specific namespace.
