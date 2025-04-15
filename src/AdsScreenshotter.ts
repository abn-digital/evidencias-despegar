import puppeteer, { Browser, Page } from "puppeteer"
import fs from "fs"
import path from "path"
import { google, sheets_v4, drive_v3 } from "googleapis"

export interface AdsScreenshotterConfig {
  adAccountId: string
  businessId: string
  campaignId: string
  screenshotType: "lifetime" | "monthly"
  adIds: string[]
  month: keyof typeof MonthToFolder
  screenshotName: string
  googleServiceAccountKeyFile: string
  gcsBucketName?: string
  cookiesPath: string
  screenshotsFolder: string
  googleSheetId: string
  googleSheetName: string
}

export const MonthToFolder = {
  "ENERO": "1ua7qdI42NO9D0mKaYLdHxLTPMcs2Kkdg",
  "FEBRERO": "1FdmlLZh8jmNXS9xZImBfuhRLY7InkB9k",
  "MARZO": "1xw25By1iaWAKOcudZ1qkVoIAVZc1vJ-q",
  "ABRIL": "1piq_bFaHbbPBSsxL441V02kKufKxUzZ0",
  "MAYO": "1jZZ90lez0chKhKdqC3hQYOjxNvObWSCa",
  "JUNIO": "16J4CVlaOxZJq91Xu2cxmLr0l8IZtVpZz",
  "JULIO": "1qIGgJ5FNeBBtvrfPDzs3FufU0WdEugFt",
  "AGOSTO": "12loY12bI2vmpAipu3OqizCijU9U5telG",
  "SEPTIEMBRE": "1HyNqKFfkTseibsTvevw3qtOVaKFf91-F",
  "OCTUBRE": "1iHt79jSS7NZMdNn7i1AqQkdPoXsczYmp",
  "NOVIEMBRE": "1mhNuACwOhqzJIezUptrB5FU8KpQp1pZJ",
  "DICIEMBRE": "1ww3mwjT8mqEjy2vmkZvqbhfMqeO1bpxp"
} as const

export default class AdsScreenshotter {
  private adAccountId: string
  private businessId: string
  private campaignId: string
  private screenshotType: "lifetime" | "monthly"
  private adIds: string[]
  private month: keyof typeof MonthToFolder
  private screenshotName: string
  private googleServiceAccountKeyFile: string
  private cookiesPath: string
  private screenshotsFolder: string
  private screenshotSelector: string
  private browser: Browser | null
  private page: Page | null
  private sheets: sheets_v4.Sheets = google.sheets("v4")
  private drive: drive_v3.Drive = google.drive("v3")
  private googleSheetId: string
  private googleSheetName: string

  constructor(config: AdsScreenshotterConfig) {
    this.adAccountId = config.adAccountId
    this.businessId = config.businessId
    this.campaignId = config.campaignId
    this.screenshotType = config.screenshotType
    this.adIds = config.adIds
    this.month = config.month
    this.screenshotName = config.screenshotName
    this.googleServiceAccountKeyFile = config.googleServiceAccountKeyFile
    this.cookiesPath = config.cookiesPath
    this.screenshotsFolder = config.screenshotsFolder
    this.screenshotSelector = 'div[role="table"]._3h1i._1mie'
    this.browser = null
    this.page = null
    this.googleSheetId = config.googleSheetId
    this.googleSheetName = config.googleSheetName

    this.initGoogleAPIs()
  }

  private initGoogleAPIs(): void {
    try {
      const authOptions: {
        scopes: string[]
        keyFile?: string
      } = {
        scopes: ["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/drive", "https://www.googleapis.com/auth/devstorage.read_write"]
      }
      if (this.googleServiceAccountKeyFile) {
        authOptions["keyFile"] = this.googleServiceAccountKeyFile
      }

      const auth = new google.auth.GoogleAuth(authOptions)
      this.sheets = google.sheets({ version: "v4", auth })
      this.drive = google.drive({ version: "v3", auth })

      console.log("Google APIs initialized successfully.")
    } catch (error) {
      console.error("Failed to initialize Google APIs:", error)
      throw error
    }
  }

  private async initializeBrowser(): Promise<void> {
    const puppeteerOptions = {
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--start-maximized"],
      defaultViewport: null
    }

    if (process.env.ENVIRONMENT === "DOCKER") {
      puppeteerOptions["headless"] = true
      puppeteerOptions["executablePath"] = "/usr/bin/chromium-browser"
    } else {
      puppeteerOptions["headless"] = false
    }

    this.browser = await puppeteer.launch(puppeteerOptions)
    this.page = await this.browser.newPage()
    const { width, height } = await this.page.evaluate(() => {
      return {
        width: window.innerWidth,
        height: window.innerHeight
      }
    })
    await this.page.setViewport({
      width: width,
      height: height
    })
  }

  private async loadCookies(): Promise<boolean> {
    try {
      if (fs.existsSync(this.cookiesPath as string)) {
        const cookies = fs.readFileSync(this.cookiesPath as string, "utf-8")
        const parsedCookies = JSON.parse(cookies)
        if (parsedCookies.length > 0) {
          await this.page!.setCookie(...parsedCookies)
          console.log("Cookies loaded successfully.")
          return true
        }
      }
      console.log("No cookies found.")
      return false
    } catch (error) {
      console.log("Cookies file not found or empty. Proceeding with manual login.")
      return false
    }
  }

  private async saveCookies(): Promise<void> {
    try {
      const currentCookies = await this.page!.cookies()
      fs.writeFileSync(this.cookiesPath as string, JSON.stringify(currentCookies, null, 2))
      console.log("Cookies saved successfully.")
    } catch (error) {
      console.error("Failed to save cookies:", error)
    }
  }

  private async navigateToTargetUrl(): Promise<void> {
    const filterSet = this.buildFilterSet()
    const columnsParam = this.buildColumnsParam()
    const lastMonthDate = new Date(new Date().setDate(1)).setHours(-1)
    const lastMonthStartDate = new Date(lastMonthDate).setDate(1)
    const startDateString = new Date(lastMonthStartDate).toISOString().split("T")[0]
    const endDateString = new Date(lastMonthDate).toISOString().split("T")[0]
    const datePreset = this.screenshotType === "lifetime" ? "maximum" : "last_month"
    const dateParam = `${startDateString}_${endDateString}%2C${datePreset}`

    const url = `https://adsmanager.facebook.com/adsmanager/manage/ads?act=${this.adAccountId}&business_id=${this.businessId}&columns=${columnsParam}&filter_set=${filterSet}&date=${dateParam}&breakdown_regrouping=true&nav_source=no_referrer`

    console.log(`Navigating to: ${url}`)

    try {
      await this.page!.goto(url, { waitUntil: "networkidle0" })

      // Check if login is required by verifying if the URL contains "login"
      const currentUrl = this.page!.url()
      if (currentUrl.includes("login")) {
        console.log("Login page detected. Entering manual login mode...")
        await this.performManualLogin()

        // Save cookies after the manual login process
        await this.saveCookies()
        console.log("Cookies saved. Restarting navigation to ensure session is loaded.")

        // Restart the navigation process
        await this.page!.goto(url, { waitUntil: "networkidle0" })
      }

      console.log("Successfully navigated to the Meta Ads page.")
      await this.handleModal()
    } catch (error) {
      console.error("Failed to navigate to target URL:", error)
      throw error
    }
  }

  private buildFilterSet(): string {
    const filterSeparator = String.fromCharCode(30)
    const adIdsFilter = this.adIds.map((adId) => `"${adId}"`).join("%2C")
    return `SEARCH_BY_ADGROUP_IDS-STRING_SET${filterSeparator}ANY${filterSeparator}[${adIdsFilter}]`
  }

  private buildColumnsParam(): string {
    const selectedColumns = ["name", "campaign_name", "campaign_group_name", "spend"]
    const columnsParam = selectedColumns.map((column) => encodeURIComponent(column)).join("%2C")
    return columnsParam
  }

  private async handleModal(): Promise<void> {
    try {
      await this.page!.waitForSelector(".layerCancel", { timeout: 5000 })
      await this.page!.click(".layerCancel")
      console.log("Closed a modal dialog.")
    } catch (error) {
      console.log("No modal dialog found.")
    }
  }

  private async waitForTable(): Promise<void> {
    try {
      console.log("Waiting for the table component to be visible...")
      const screenshotSelector = 'div[role="table"]._3h1i._1mie'
      await this.page!.waitForSelector(screenshotSelector, {
        timeout: 30000,
        visible: true
      })
      console.log("Table component is visible.")
      console.log("Waiting 5 seconds for content to stabilize...")
      await this.delay(5000)
    } catch (error) {
      console.error("Table component not found or not visible:", error)
      throw error
    }
  }

  private async takeScreenshot(): Promise<string> {
    try {
      const element = await this.page!.$(this.screenshotSelector)
      if (!element) {
        throw new Error("Could not find the table component")
      }

      const box = await element.boundingBox()
      if (!box) {
        throw new Error("Could not get element boundaries")
      }

      await element.evaluate((el) => {
        el.scrollIntoView({ behavior: "instant", block: "start" })
      })

      if (!fs.existsSync(this.screenshotsFolder)) {
        fs.mkdirSync(this.screenshotsFolder, { recursive: true })
      }
      const screenshotPath = path.join(this.screenshotsFolder, this.screenshotName)
      await this.page!.screenshot({
        path: screenshotPath,
        clip: {
          x: Math.max(0, box.x),
          y: Math.max(0, box.y),
          width: Math.min(box.width, 1920),
          height: Math.min(box.height * 1, 1080)
        }
      })

      console.log(`Screenshot saved at: ${screenshotPath}`)

      return screenshotPath
    } catch (error) {
      console.error("Failed to take screenshot:", error)
      throw error
    }
  }

  private async performAutomaticLogin(authenticationFactor: string): Promise<void> {
    try {
      console.log("Navigating to Facebook login page...")
      await this.page!.goto("https://www.facebook.com/login", {
        waitUntil: "networkidle2"
      })
      const email = process.env.EMAIL
      const password = process.env.PASSWORD

      if (this.page) {
        await this.page.type("#email", email as string)
        await this.page.type("#pass", password as string)
        await this.page.click('button[type="submit"]')
      }

      const element = await this.page!.waitForSelector('input[type="text"]', { timeout: 5000 })
      if (!element) {
        throw new Error("2FA not selector not found")
      }

      if (this.page) {
        await this.page.type('input[type="text"]', authenticationFactor)
        await this.delay(1000)
        await this.page.click('div[role="button"]')
      }

      console.log("Wait 10 seconds for cookies to be stored")
      await this.delay(10000)
      await this.saveCookies()
    } catch (error) {
      console.error("Manual login failed:", error)
      throw error
    }
  }

  private async performManualLogin(): Promise<void> {
    try {
      console.log("Navigating to Facebook login page...")
      await this.page!.goto("https://www.facebook.com/login", {
        waitUntil: "networkidle2"
      })
      const email = process.env.EMAIL
      const password = process.env.PASSWORD

      if (this.page) {
        await this.page.type("#email", email as string)
        await this.page.type("#pass", password as string)
        await this.page.click('button[type="submit"]')
      }

      console.log("Please log in manually. Waiting 30 seconds...")
      await this.delay(30000)
      await this.saveCookies()
    } catch (error) {
      console.error("Manual login failed:", error)
      throw error
    }
  }

  private async navigateAndTakeScreenshot(): Promise<string> {
    await this.navigateToTargetUrl()
    await this.waitForTable()
    const screenshotPath = await this.takeScreenshot()
    return screenshotPath
  }

  private async delay(time: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, time))
  }

  /**
   * Uploads the screenshot to Google Drive and returns a sharable link.
   */
  private async uploadScreenshotToDrive(filePath: string, parentId: string): Promise<string> {
    try {
      const fileMetadata = {
        name: path.basename(filePath),
        mimeType: "image/png",
        parents: [parentId]
      }
      const media = {
        mimeType: "image/png",
        body: fs.createReadStream(filePath)
      }

      const file = await this.drive.files.create({
        requestBody: fileMetadata,
        media: media,
        fields: "id",
        supportsAllDrives: true
      })

      const fileId = file.data.id
      console.log(`File uploaded to Drive with ID: ${fileId}`)

      // Make the file publicly accessible
      await this.drive.permissions.create({
        fileId: fileId!,
        requestBody: {
          role: "reader",
          type: "anyone"
        },
        supportsAllDrives: true
      })

      // Get the direct link
      const directLink = `https://drive.google.com/uc?id=${fileId}`
      console.log(`Direct link to the image: ${directLink}`)

      return directLink
    } catch (error) {
      console.error("Failed to upload screenshot to Drive:", error)
      throw error
    }
  }

  /**
   * Inserts the image URL into the specified cell in Google Sheets.
   */
  private async insertUrlsIntoSheet(campaignImageUrl: string): Promise<void> {
    try {
      const request = {
        spreadsheetId: this.googleSheetId,
        range: `${this.googleSheetName}`,
        valueInputOption: "USER_ENTERED",
        insertDataOption: "INSERT_ROWS",
        requestBody: {
          values: [[this.adAccountId, this.campaignId, campaignImageUrl, this.screenshotName, this.screenshotType]]
        }
      }

      await this.sheets.spreadsheets.values.append(request)
      console.log(`Image URLs inserted into ${this.googleSheetName}`)
    } catch (error) {
      console.error("Failed to insert URLs into Google Sheet:", error)
      throw error
    }
  }

  /**
   * Orchestrates the Google Sheets update by uploading the screenshot and inserting the URL.
   */
  private async updateGoogleSheetWithScreenshots(campaignScreenshotPath: string): Promise<void> {
    const CAMPAIGN_FOLDER_ID = MonthToFolder[this.month] //Folder id de EVIDENCIAS de acuerdo a mes.
    try {
      const campaignImageUrl = await this.uploadScreenshotToDrive(campaignScreenshotPath, CAMPAIGN_FOLDER_ID)

      await this.insertUrlsIntoSheet(campaignImageUrl)
    } catch (error) {
      console.error("Failed to update Google Sheet with screenshots:", error)
      throw error
    }
  }

  public async run(authenticationFactor: any = null, cleanCookies = false): Promise<void> {
    let hadError = false
    let campaignScreenshotPath: string

    try {
      await this.initializeBrowser()
      const cookiesLoaded = await this.loadCookies()

      if (!cookiesLoaded && !authenticationFactor) {
        await this.performManualLogin()
      }

      if (!cookiesLoaded && authenticationFactor) {
        await this.performAutomaticLogin(authenticationFactor)
      }

      campaignScreenshotPath = await this.navigateAndTakeScreenshot()

      // Update Google Sheet with the screenshot URL
      await this.updateGoogleSheetWithScreenshots(campaignScreenshotPath)
    } catch (error) {
      hadError = true
      console.error("An error occurred during the process:", error)

      throw error
    } finally {
      if (this.browser) {
        await this.browser.close()
        console.log("Browser closed.")
      }

      if (!hadError) {
        // Clean up the screenshots folder
        if (fs.existsSync(this.screenshotsFolder)) {
          fs.rmSync(this.screenshotsFolder, { recursive: true, force: true })
          console.log("Cleaned up screenshots folder.")
        }
      }

      if (cleanCookies) {
        if (fs.existsSync(this.cookiesPath as string)) {
          fs.unlinkSync(this.cookiesPath as string)
          console.log("Deleted cookies file.")
        }
      }
    }
  }
}
