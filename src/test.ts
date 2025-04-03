import http from "http"

process.loadEnvFile(".env")
// Define the payload
const data = JSON.stringify({
  adAccountId: "2316303571926135",
  businessId: "411498659732220",
  campaignId: "120212564829970604",
  authenticationFactor: "123123"
})

// Define the request options
const options = {
  url: process.env.REQUEST_URL!,
  port: 80,
  path: "/screenshot",
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(data)
  }
}

// Create the requesta
const req = http.request(options, (res) => {
  let responseBody = ""

  console.log(`Status Code: ${res.statusCode}`)

  // Collect response data
  res.on("data", (chunk) => {
    responseBody += chunk
  })

  // Handle end of response
  res.on("end", () => {
    try {
      const parsed = JSON.parse(responseBody)
      console.log("Response:", parsed)
    } catch (e) {
      console.log("Response:", responseBody)
    }
  })
})

// Handle request errors
req.on("error", (error) => {
  console.error("Error:", error)
})

// Write data to request body
req.write(data)

// End the request
req.end()
