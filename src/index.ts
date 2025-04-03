import express from "express"
import AdsScreenshotter from "./AdsScreenshotter.ts"

export interface AdsScreenshotterConfig {
  adAccountId: string
  businessId: string
  campaignId: string
  screenshotType: "lifetime" | "monthly"
  googleServiceAccountKeyFile?: string
  cookiesPath?: string
  screenshotsFolder?: string
  googleSheetId: string
  googleSheetName: string
  targetCell: string
}

try {
  process.loadEnvFile(".env")
} catch (e) {}
console.log("CURRENT ENVIRONMENT:\n", process.env)

const app = express()
const port = process.env.PORT || 80

// Middleware to parse JSON bodies
app.use(express.json())

// Root endpoint to serve the PNG image
app.get("/", (req, res) => {
  let imagePath: string

  if (process.env.IMAGE_PATH) {
    const cwd = process.cwd()
    imagePath = cwd 
     process.env.IMAGE_PATH
  } else {
    imagePath =
      "https://media.licdn.com/dms/image/v2/D4D0BAQGYnMuXq_eAZA/company-logo_200_200/company-logo_200_200/0/1706105767413/abndigital_logo?e=2147483647&v=beta&t=id3iaoiHGp6RYTV81duSPDuiMeWU4AweNdGl-VOLqqw"
  }

  res.sendFile(imagePath, (err) => {
    if (err) {
      res.status(500).send("Error serving the image.")
    } else {
      console.log("Image sent successfully.")
    }
  })
})

// Optional: health check or status endpoint
app.get("/status", (req, res) => {
  res.status(200).send("Ads Screenshotter Service is running.")
})

// Screenshot Endpoint
app.post("/screenshot", async (req, res: any) => {
  const { adAccountId, businessId, campaignId, authenticationFactor, screenshotType } = req.body

  // Basic validation
  if (!adAccountId || !businessId || !campaignId || !screenshotType) {
    return res.status(400).json({
      error: "Missing required fields. Please provide 'adAccountId', 'businessId', 'campaignId' and 'screenshotType'."
    })
  }

  // Validate Google API configurations
  const requiredEnvVars = ["GOOGLE_SHEET_ID", "GOOGLE_SHEET_NAME"]
  const missingEnvVars = requiredEnvVars.filter((varName) => !process.env[varName])
  if (missingEnvVars.length > 0) {
    return res.status(500).json({
      error: `Missing required environment variables: ${missingEnvVars.join(", ")}`
    })
  }

  // Configuration for AdsScreenshotter
  const config: AdsScreenshotterConfig = {
    adAccountId,
    businessId,
    campaignId,
    screenshotType,
    googleServiceAccountKeyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE!,
    cookiesPath: process.env.COOKIES_PATH!,
    screenshotsFolder: process.env.SCREENSHOTS_FOLDER!,
    googleSheetId: process.env.GOOGLE_SHEET_ID!,
    googleSheetName: process.env.GOOGLE_SHEET_NAME!,
    targetCell: process.env.TARGET_CELL!
  }

  try {
    const adsScreenshotter = new AdsScreenshotter(config)
    await adsScreenshotter.run(authenticationFactor)

    res.status(200).json({
      message: "Screenshot taken and uploaded successfully."
    })
  } catch (error) {
    console.error("Error processing screenshot:", error)
    res.status(500).json({
      error: "Failed to process the screenshot.",
      details: error instanceof Error ? error.message : String(error)
    })
  }
})

// Start the server
app.listen(port, () => {
  console.log(`Ads Screenshotter service is listening on port ${port}`)
})
