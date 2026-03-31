import { MASTER_PHONE } from '../middleware/auth.middleware.js';
import { User } from '../models/user.model.js';
import { checkRateLimit, sendPhoneOTP, verifyOTP } from '../services/otp.unified.service.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';

// In-memory registration data store (since Redis may not be available)
const registrationStore = new Map();
const REGISTRATION_EXPIRY = 300000; // 5 minutes

const genrateAccessTokenAndRefresToken = async (user) => {
  const accessToken = await user.genreateAccessToken();
  const refreshToken = await user.genrateRefreshToken();
  return { refreshToken, accessToken };
};

// Clean expired registration data periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, data] of registrationStore.entries()) {
    if (data.expiresAt < now) {
      registrationStore.delete(key);
    }
  }
}, 60000);

// ============================================
// REGISTRATION - Step 1: Send OTP
// ============================================

const userRegister = asyncHandler(async (req, res) => {
  const { firstName, lastName, email, phone, password, address, role, subRole } = req.body;

  // Validation - must provide phone number
  if (!phone) {
    throw new ApiError(400, 'Phone number is required');
  }

  if (!password) {
    throw new ApiError(400, 'Password is required');
  }

  if (password.length < 6) {
    throw new ApiError(400, 'Password must be at least 6 characters long');
  }

  if (!firstName || !lastName) {
    throw new ApiError(400, 'First name and last name are required');
  }

  const identifier = phone.trim();

  // Check if user already exists
  const existingUser = await User.findOne({ phone: identifier });
  if (existingUser) {
    throw new ApiError(400, 'User with this phone number already exists');
  }

  // Check rate limit
  const rateLimit = checkRateLimit(identifier, 'phone');
  if (!rateLimit.allowed) {
    throw new ApiError(429, rateLimit.message);
  }

  // Store registration data in memory
  const registrationData = {
    firstName: firstName.trim(),
    lastName: lastName.trim(),
    email: email || null,
    phone: identifier,
    password,
    address: address || {},
    role: role || 'farmer',
    subRole: role === 'aloo-mitra' && subRole ? subRole : null,
    expiresAt: Date.now() + REGISTRATION_EXPIRY,
  };

  const registrationKey = `registration:phone:${identifier}`;
  registrationStore.set(registrationKey, registrationData);

  // Send OTP
  const otpResult = await sendPhoneOTP(identifier);

  // In dev mode, return OTP for testing
  const responseData = { phone: identifier };
  if (process.env.DEV_MODE === 'true' && otpResult.otp) {
    responseData.otp = otpResult.otp; // Only in dev mode!
  }

  return res.json(
    new ApiResponse(200, responseData, 'OTP sent successfully. Valid for 2 minutes.')
  );
});

// ============================================
// REGISTRATION - Step 2: Verify OTP and Create User
// ============================================

const verifyOTPAndRegister = asyncHandler(async (req, res) => {
  const { phone, otp } = req.body;

  // Validation
  if (!phone) {
    throw new ApiError(400, 'Phone number is required');
  }

  if (!otp) {
    throw new ApiError(400, 'OTP is required');
  }

  const identifier = phone.trim();

  // Verify OTP
  const otpVerification = await verifyOTP(identifier, otp, 'phone');
  if (!otpVerification.success) {
    throw new ApiError(400, otpVerification.message);
  }

  // Get registration data from memory store
  const registrationKey = `registration:phone:${identifier}`;
  const registrationData = registrationStore.get(registrationKey);

  if (!registrationData) {
    throw new ApiError(400, 'Registration session expired. Please register again.');
  }

  if (registrationData.expiresAt < Date.now()) {
    registrationStore.delete(registrationKey);
    throw new ApiError(400, 'Registration session expired. Please register again.');
  }

  console.log('Registration Data:', registrationData);

  // Create user in MongoDB
  const userData = {
    firstName: registrationData.firstName,
    lastName: registrationData.lastName,
    password: registrationData.password,
    phone: identifier,
    isPhoneVerified: true,
    role: registrationData.role || 'farmer',
    subRole: registrationData.subRole || null,
    address: registrationData.address || {},
  };

  const createdUser = await User.create(userData);

  // Delete registration data from memory
  registrationStore.delete(registrationKey);

  // Generate tokens
  const { accessToken, refreshToken } = await genrateAccessTokenAndRefresToken(createdUser);
  createdUser.refreshToken = refreshToken;
  await createdUser.save({ validateBeforeSave: false });

  const userResponse = await User.findById(createdUser._id).select('-refreshToken');

  return res
    .status(201)
    .json(
      new ApiResponse(
        201,
        { user: userResponse, accessToken, refreshToken },
        'User registered successfully'
      )
    );
});

// ============================================
// LOGIN (Password-based with Email or Phone)
// ============================================

const userLogin = asyncHandler(async (req, res) => {
  const { email, phone, password } = req.body;

  // Validation
  if (!password) {
    throw new ApiError(400, 'Password is required');
  }

  if (!email && !phone) {
    throw new ApiError(400, 'Please provide either email or phone number');
  }

  let identifier = email || phone;

  // Find user by email or phone
  const userLoggedIn = await User.findOne({
    $or: [{ email: identifier }, { phone: identifier }],
  }).select('+password');

  if (!userLoggedIn) {
    throw new ApiError(404, 'User does not exist');
  }

  // Password match
  const isMatch = await userLoggedIn.isPasswordMatch(password);
  if (!isMatch) {
    throw new ApiError(401, 'Invalid credentials');
  }

  // Auto-set master role for master phone
  if (userLoggedIn.phone === MASTER_PHONE && userLoggedIn.role !== 'master') {
    userLoggedIn.role = 'master';
    userLoggedIn.isMaster = true;
    await userLoggedIn.save({ validateBeforeSave: false });
  }

  // Generate tokens
  const { accessToken, refreshToken } = await genrateAccessTokenAndRefresToken(userLoggedIn);

  // Save refresh token
  userLoggedIn.refreshToken = refreshToken;
  await userLoggedIn.save({ validateBeforeSave: false });

  // Remove password from response
  const newUser = await User.findById(userLoggedIn._id).select('-refreshToken');

  return res.json(
    new ApiResponse(
      200,
      { user: newUser, accessToken, refreshToken },
      'User logged in successfully'
    )
  );
});

const logout = asyncHandler(async (req, res) => {
  // Clear refresh token from database
  await User.findByIdAndUpdate(req.user._id, { $unset: { refreshToken: 1 } }, { new: true });

  return res.json(new ApiResponse(200, {}, 'User logged out successfully'));
});

// ============================================
// DEV REGISTRATION (No OTP - for testing)
// ============================================

const devRegister = asyncHandler(async (req, res) => {
  const { firstName, lastName, email, phone, password, role, address } = req.body;

  // Validation
  if (!email && !phone) {
    throw new ApiError(400, 'Please provide either email or phone number');
  }

  if (!password || password.length < 6) {
    throw new ApiError(400, 'Password must be at least 6 characters long');
  }

  if (!firstName || !lastName) {
    throw new ApiError(400, 'First name and last name are required');
  }

  // Check if user already exists
  let existingUser;
  if (email) {
    existingUser = await User.findOne({ email: email.trim() });
  }
  if (phone) {
    existingUser = existingUser || (await User.findOne({ phone: phone.trim() }));
  }

  if (existingUser) {
    throw new ApiError(400, 'User already exists');
  }

  // Create user directly without OTP
  const userData = {
    firstName: firstName.trim(),
    lastName: lastName.trim(),
    password,
    role: role || 'farmer',
    address: address || {
      village: 'Default Village',
      district: 'Default District',
      state: 'Default State',
      pincode: '000000',
    },
  };

  if (email) {
    userData.email = email.trim();
    userData.isEmailVerified = true;
  }
  if (phone) {
    userData.phone = phone.trim();
    userData.isPhoneVerified = true;
  }

  const createdUser = await User.create(userData);

  // Generate tokens
  const { accessToken, refreshToken } = await genrateAccessTokenAndRefresToken(createdUser);
  createdUser.refreshToken = refreshToken;
  await createdUser.save({ validateBeforeSave: false });

  const userResponse = await User.findById(createdUser._id).select('-refreshToken');

  return res
    .status(201)
    .json(
      new ApiResponse(
        201,
        { user: userResponse, accessToken, refreshToken },
        'User registered successfully'
      )
    );
});

// ============================================
// GET USER PROFILE
// ============================================

const getUserProfile = asyncHandler(async (req, res) => {
  const { userId } = req.params;

  const user = await User.findById(userId).select('-refreshToken -password');

  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  return res.json(new ApiResponse(200, user, 'User profile fetched successfully'));
});

// ============================================
// GET ALL USERS (for directory)
// ============================================

const getAllUsers = asyncHandler(async (req, res) => {
  const { role, search } = req.query;
  const currentUserId = req.user._id;

  let query = { _id: { $ne: currentUserId } };

  if (role && ['farmer', 'trader', 'cold-storage'].includes(role)) {
    query.role = role;
  }

  if (search) {
    query.$or = [
      { firstName: { $regex: search, $options: 'i' } },
      { lastName: { $regex: search, $options: 'i' } },
      { phone: { $regex: search, $options: 'i' } },
    ];
  }

  const users = await User.find(query).select('firstName lastName role phone address').limit(100);

  return res.json(new ApiResponse(200, users, 'Users fetched successfully'));
});

// ============================================
// RESEND OTP
// ============================================

const resendOTP = asyncHandler(async (req, res) => {
  const { phone } = req.body;

  if (!phone) {
    throw new ApiError(400, 'Phone number is required');
  }

  const identifier = phone.trim();

  // Check rate limit
  const rateLimit = checkRateLimit(identifier, 'phone');
  if (!rateLimit.allowed) {
    throw new ApiError(429, rateLimit.message);
  }

  // Check if registration data exists
  const registrationKey = `registration:phone:${identifier}`;
  const registrationData = registrationStore.get(registrationKey);

  if (!registrationData) {
    throw new ApiError(400, 'No pending registration found. Please register again.');
  }

  // Extend expiry
  registrationData.expiresAt = Date.now() + REGISTRATION_EXPIRY;
  registrationStore.set(registrationKey, registrationData);

  // Send new OTP
  const otpResult = await sendPhoneOTP(identifier);

  const responseData = { phone: identifier };
  if (process.env.DEV_MODE === 'true' && otpResult.otp) {
    responseData.otp = otpResult.otp;
  }

  return res.json(new ApiResponse(200, responseData, 'OTP resent successfully'));
});

// ============================================
// LOGIN WITH OTP - Step 1: Send OTP
// ============================================

const sendLoginOTP = asyncHandler(async (req, res) => {
  const { phone } = req.body;

  if (!phone) {
    throw new ApiError(400, 'Phone number is required');
  }

  const identifier = phone.trim();

  // Check if user exists
  const user = await User.findOne({ phone: identifier });
  if (!user) {
    throw new ApiError(404, 'User not found. Please register first.');
  }

  // Check rate limit
  const rateLimit = checkRateLimit(identifier, 'phone');
  if (!rateLimit.allowed) {
    throw new ApiError(429, rateLimit.message);
  }

  // Send OTP
  const otpResult = await sendPhoneOTP(identifier, 'login');

  const responseData = { phone: identifier };
  if (process.env.DEV_MODE === 'true' && otpResult.otp) {
    responseData.otp = otpResult.otp;
  }

  return res.json(new ApiResponse(200, responseData, 'OTP sent successfully'));
});

// ============================================
// LOGIN WITH OTP - Step 2: Verify OTP
// ============================================

const verifyLoginOTP = asyncHandler(async (req, res) => {
  const { phone, otp } = req.body;

  if (!phone) {
    throw new ApiError(400, 'Phone number is required');
  }

  if (!otp) {
    throw new ApiError(400, 'OTP is required');
  }

  const identifier = phone.trim();

  // Verify OTP
  const otpVerification = await verifyOTP(identifier, otp, 'phone');
  if (!otpVerification.success) {
    throw new ApiError(400, otpVerification.message);
  }

  // Find user
  const user = await User.findOne({ phone: identifier });
  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  // Auto-set master role for master phone
  if (user.phone === MASTER_PHONE && user.role !== 'master') {
    user.role = 'master';
    user.isMaster = true;
    await user.save({ validateBeforeSave: false });
  }

  // Generate tokens
  const { accessToken, refreshToken } = await genrateAccessTokenAndRefresToken(user);
  user.refreshToken = refreshToken;
  await user.save({ validateBeforeSave: false });

  const userResponse = await User.findById(user._id).select('-refreshToken -password');

  return res.json(
    new ApiResponse(200, { user: userResponse, accessToken, refreshToken }, 'Login successful')
  );
});

// ============================================
// UPDATE USER PROFILE
// ============================================

const updateUserProfile = asyncHandler(async (req, res) => {
  const { firstName, lastName, address, role } = req.body;
  const userId = req.user._id;

  // Protect master account - cannot change role
  if (req.user.phone === MASTER_PHONE || req.user.role === 'master') {
    if (role && role !== 'master') {
      throw new ApiError(403, 'Master role cannot be changed');
    }
  }

  const updateData = {};

  if (firstName) updateData.firstName = firstName.trim();
  if (lastName) updateData.lastName = lastName.trim();
  if (role) {
    // Only master can assign admin/master roles
    if (['admin', 'master'].includes(role)) {
      if (req.user.phone !== MASTER_PHONE && req.user.role !== 'master') {
        throw new ApiError(403, 'Only master can assign admin role');
      }
    }
    if (['farmer', 'trader', 'cold-storage', 'admin', 'aloo-mitra', 'master'].includes(role)) {
      updateData.role = role;
    }
  }
  if (address) {
    updateData.address = {
      village: address.village?.trim() || '',
      district: address.district?.trim() || '',
      state: address.state?.trim() || '',
    };
  }

  const updatedUser = await User.findByIdAndUpdate(
    userId,
    { $set: updateData },
    { new: true, runValidators: true }
  ).select('-refreshToken -password');

  if (!updatedUser) {
    throw new ApiError(404, 'User not found');
  }

  return res.json(new ApiResponse(200, { user: updatedUser }, 'Profile updated successfully'));
});

// ============================================
// GET ALOO MITRAS
// ============================================

const getAlooMitras = asyncHandler(async (req, res) => {
  const { subRole, serviceType, state, district, village } = req.query;

  const query = { role: 'aloo-mitra' };

  // Valid service types that Aloo Mitra can have
  const validSubRoles = [
    'potato-seeds',
    'fertilizers',
    'machinery-rent',
    'transportation',
    'gunny-bag',
    'majdoor',
  ];

  // Filter by serviceType (stored in alooMitraProfile.serviceType)
  const filterValue = serviceType || subRole;
  if (filterValue) {
    // Handle comma-separated values (e.g., "machinery-new,machinery-rent")
    const serviceTypes = filterValue
      .split(',')
      .filter((role) => validSubRoles.includes(role.trim()));
    if (serviceTypes.length === 1) {
      query['alooMitraProfile.serviceType'] = serviceTypes[0];
    } else if (serviceTypes.length > 1) {
      query['alooMitraProfile.serviceType'] = { $in: serviceTypes };
    }
  }

  // Filter by location (address fields)
  if (state) {
    query['address.state'] = { $regex: new RegExp(state, 'i') };
  }
  if (district) {
    query['address.district'] = { $regex: new RegExp(district, 'i') };
  }
  if (village) {
    query['address.village'] = { $regex: new RegExp(village, 'i') };
  }

  const alooMitras = await User.find(query)
    .select('firstName lastName phone subRole address alooMitraProfile')
    .sort({ createdAt: -1 });

  return res.json(new ApiResponse(200, alooMitras, 'Aloo Mitras fetched successfully'));
});

// ============================================
// DEV: Find existing manager (for dev login)
// ============================================
const devFindManager = asyncHandler(async (req, res) => {
  // Find the most recently created cold-storage-manager with an assigned cold storage
  const manager = await User.findOne({
    role: 'cold-storage-manager',
    managedColdStorage: { $ne: null },
  })
    .sort({ createdAt: -1 })
    .select('phone firstName lastName managedColdStorage');

  if (!manager) {
    return res.json(
      new ApiResponse(200, { found: false }, 'No assigned manager found')
    );
  }

  return res.json(
    new ApiResponse(200, {
      found: true,
      phone: manager.phone,
      firstName: manager.firstName,
      lastName: manager.lastName,
    }, 'Manager found')
  );
});

export {
  devFindManager,
  devRegister,
  getAllUsers,
  getAlooMitras,
  getUserProfile,
  logout,
  resendOTP,
  sendLoginOTP,
  updateUserProfile,
  userLogin,
  userRegister,
  verifyLoginOTP,
  verifyOTPAndRegister,
};
