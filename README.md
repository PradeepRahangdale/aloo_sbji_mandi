# OTP-Based User Registration with Redis

## Overview
Clean 2-step registration process:
1. **`/register`** - Sends OTP, stores data in **Redis** (2 minutes)
2. **`/verify-otp`** - Verifies OTP, creates user in **MongoDB**

**User is NOT created until OTP is verified!**

---

## Quick Setup

```bash
# 1. Install & Start Redis
brew install redis
brew services start redis

# 2. Configure .env
EMAIL_USER=your-email@gmail.com
EMAIL_PASSWORD=your-gmail-app-password
TWILIO_ACCOUNT_SID=your-sid
TWILIO_AUTH_TOKEN=your-token
TWILIO_PHONE_NUMBER=+1234567890
REDIS_URL=redis://localhost:6379

# 3. Start Server
npm run dev
```

---

## API Endpoints

### Base URL: `/api/v1/user`

---

## 📝 Registration Flow

### Step 1: Send OTP (Data stored in Redis)

**Endpoint:** `POST /register`

**Email Registration:**
```json
{
  "email": "user@example.com",
  "password": "password123",
  "firstName": "John",
  "lastName": "Doe"
}
```

**Phone Registration:**
```json
{
  "phone": "+1234567890",
  "password": "password123",
  "firstName": "John",
  "lastName": "Doe"
}
```

**Response:**
```json
{
  "success": true,
  "statusCode": 200,
  "data": {
    "email": "user@example.com"  // or "phone"
  },
  "message": "OTP sent to email successfully. Valid for 2 minutes."
}
```

**What happens:**
- ✅ Checks if user already exists in MongoDB
- ✅ Stores registration data in Redis (expires in 2 minutes)
- ✅ Sends OTP via email or SMS
- ❌ User NOT created yet

---

### Step 2: Verify OTP & Create User

**Endpoint:** `POST /verify-otp`

**Email Verification:**
```json
{
  "email": "user@example.com",
  "otp": "123456"
}
```

**Phone Verification:**
```json
{
  "phone": "+1234567890",
  "otp": "123456"
}
```

**Response:**
```json
{
  "success": true,
  "statusCode": 201,
  "data": {
    "user": {
      "_id": "...",
      "email": "user@example.com",
      "username": "johndoe",
      "isEmailVerified": true,
      "role": "farmer"
    },
    "accessToken": "...",
    "refreshToken": "..."
  },
  "message": "User registered successfully"
}
```

**What happens:**
- ✅ Verifies OTP from Redis
- ✅ Retrieves registration data from Redis
- ✅ Creates user in MongoDB
- ✅ Deletes data from Redis
- ✅ Returns JWT tokens

---

## 🔐 Login

**Endpoint:** `POST /login`

**Email Login:**
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**Phone Login:**
```json
{
  "phone": "+1234567890",
  "password": "password123"
}
```

**Response:**
```json
{
  "success": true,
  "statusCode": 200,
  "data": {
    "user": { ... },
    "accessToken": "...",
    "refreshToken": "..."
  },
  "message": "User logged in successfully"
}
```

---

## 🔒 Protected Routes

### Get Current User
```
GET /me
Headers: Authorization: Bearer <accessToken>
```

### Logout
```
POST /logout
Headers: Authorization: Bearer <accessToken>
```

---

## 📊 Complete Example

### Email Registration:
```bash
# Step 1: Register (sends OTP, stores in Redis)
POST /api/v1/user/register
{
  "email": "test@example.com",
  "password": "password123",
  "username": "testuser"
}

# Step 2: Check email for OTP (valid 2 minutes)

# Step 3: Verify OTP (creates user in MongoDB)
POST /api/v1/user/verify-otp
{
  "email": "test@example.com",
  "otp": "123456"
}

# Step 4: Login
POST /api/v1/user/login
{
  "email": "test@example.com",
  "password": "password123"
}
```

### Phone Registration:
```bash
# Step 1: Register (sends OTP, stores in Redis)
POST /api/v1/user/register
{
  "phone": "+1234567890",
  "password": "password123"
}

# Step 2: Check SMS for OTP (valid 2 minutes)

# Step 3: Verify OTP (creates user in MongoDB)
POST /api/v1/user/verify-otp
{
  "phone": "+1234567890",
  "otp": "123456"
}

# Step 4: Login
POST /api/v1/user/login
{
  "phone": "+1234567890",
  "password": "password123"
}
```

---

## 🎯 How It Works

### Registration Data Flow:

```
1. POST /register
   ↓
   Check if user exists in MongoDB
   ↓
   Store {username, email/phone, password} in Redis (2 min)
   ↓
   Send OTP via email/SMS
   ↓
   Return success

2. POST /verify-otp
   ↓
   Verify OTP from Redis
   ↓
   Get registration data from Redis
   ↓
   Create user in MongoDB
   ↓
   Delete data from Redis
   ↓
   Return user + tokens
```

---

## ⚙️ Configuration

- **OTP Expiry:** 2 minutes
- **Registration Data Expiry:** 2 minutes (in Redis)
- **Rate Limit:** 3 OTP requests per 15 minutes
- **OTP Length:** 6 digits
- **Password:** Minimum 6 characters

---

## 🎯 Key Features

✅ **User created ONLY after OTP verification**  
✅ **Registration data stored in Redis** (temporary, 2 min)  
✅ **OTP expires in 2 minutes**  
✅ **Auto-detects email or phone**  
✅ **Password-based login** (no OTP)  
✅ **Rate limiting** to prevent abuse  
✅ **Clean separation** of concerns  

---

## 📝 Error Handling

**Common Errors:**

- `400` - User already exists
- `400` - OTP expired or invalid
- `400` - Registration session expired (need to call /register again)
- `404` - User not found (during login)
- `401` - Invalid credentials
- `429` - Too many OTP requests

---

## Gmail App Password Setup

1. Google Account → Security
2. Enable 2-Step Verification
3. App Passwords → Generate for "Mail"
4. Copy 16-character password
5. Use in `EMAIL_PASSWORD`

---

## 🛠️ Tech Stack

- **Backend:** Node.js + Express
- **Database:** MongoDB (User storage)
- **Cache:** Redis (OTP + Registration data)
- **Email:** Nodemailer
- **SMS:** Twilio
- **Auth:** JWT + bcrypt

---

**Clean, secure, and simple!** 🚀
