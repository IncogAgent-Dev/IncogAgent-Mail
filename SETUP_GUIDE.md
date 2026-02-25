# ⚙️ Local Setup & Installation Guide

Welcome to the setup guide for **IncogAgent Mail**. 

Because this extension interacts directly with your private Gmail data, it requires a Google OAuth 2.0 Client ID. To ensure maximum security and privacy, you will create your own Google Cloud Project so that your data flow remains entirely under your control.

Don't worry if you haven't done this before—just follow these steps exactly!

---

## Step 1: Get the Extension Code

You can get the code either by downloading a ZIP file or using Git.

**Option A: Download ZIP (Easiest)**
1. Download the ZIP file.
2. **Important:** Extract (unzip) the downloaded file to a folder on your computer.

**Option B: Use Git (For developers)**
```bash
git clone [https://github.com/IncogAgent-Dev/IncogAgent-Mail.git](https://github.com/IncogAgent-Dev/IncogAgent-Mail.git)
cd IncogAgent-Mail
```

## Step 2: Set Up Your Google Cloud Project

1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a **New Project** (you can name it something like "IncogAgent-Mail").
3. In the left sidebar menu, navigate to **APIs & Services** > **Library**.
4. Search for **Gmail API** and click **Enable**.

## Step 3: Configure the OAuth Consent Screen

1. In the left sidebar, go to **APIs & Services** > **OAuth consent screen**.
2. Select the **External** user type and click **Create** (if prompted).
3. Fill in the **App information**:
   * **App name:** IncogAgent Mail
   * **User support email:** (Your email address)
   * **Developer contact information:** (Your email address)
4. Scroll down to the **Audience** section (or click the Audience tab). 
   * Under **Test users**, click **Add Users** and enter your personal Gmail address. 
   * *(Note: Only the exact email addresses you add here will be authorized to log in and use the extension).*
5. Scroll down to the **Data Access** section (or click the Data Access tab), and click **Add or Remove Scopes**.
6. In the menu that appears, paste exactly this URL into the manual entry box: 
   `https://www.googleapis.com/auth/gmail.modify`
7. Select the scope from the list, click **Add**, and then click **Save**.

## Step 4: Generate Your Client ID

1. In the left sidebar, go to **APIs & Services** > **Clients** (Note: In some older Google Cloud interfaces, this menu might still be named **Credentials**).
2. Click **Create Client** (or **+ Create Credentials** at the top) and select **OAuth client ID**.
3. In the **Application type** dropdown, select **Chrome Extension**.
4. Give it a name (e.g., "IncogAgent Mail").
5. In the **Item ID** (or Application ID) field, paste exactly this ID:
   > `idiblcepkehoiomnmddgaoonpkkmcboi`
6. Click **Create**.
7. A pop-up will appear with your new **Client ID**. Copy this long string.

## Step 5: Update the Configuration File

1. Open the `IncogAgent-Mail` folder on your computer.
2. Open the `manifest.json` file using any text editor (like Notepad, VS Code, or TextEdit).
3. Find the `oauth2` section. You will see a placeholder Client ID that looks like this:
`"000000000000-placeholder.apps.googleusercontent.com"`
4. **Replace** that placeholder with the actual Client ID you just copied in Step 4.
```json
"oauth2": {
  "client_id": "YOUR_ACTUAL_CLIENT_ID_HERE.apps.googleusercontent.com",
  "scopes": ["[https://www.googleapis.com/auth/gmail.modify](https://www.googleapis.com/auth/gmail.modify)"]
}

```


5. **Save the file!**

## Step 6: Load into Chrome

1. Open Google Chrome and type `chrome://extensions/` in the address bar.
2. Turn on **Developer mode** (the toggle switch in the top right corner).
3. Click the **Load unpacked** button in the top left.
4. Select the `IncogAgent-Mail` folder on your computer (make sure you select the unzipped folder containing the `manifest.json` file).

**🎉 You're all set!** You can now open Gmail, click the IncogAgent extension icon in your browser toolbar, log in with the test email you configured, and start using the local-first summarization pipeline safely.