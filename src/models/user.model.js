import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';

const user_schema = new mongoose.Schema(
  {
    firstName: {
      type: String,
      required: true,
      trim: true,
    },

    lastName: {
      type: String,
      required: true,
      trim: true,
    },

    email: {
      type: String,
      sparse: true, // Allows multiple null values, users can register with phone only
      unique: true,
      trim: true,
      lowercase: true,
    },

    phone: {
      type: String,
      sparse: true, // Allows multiple null values, users can register with email only
      unique: true,
      trim: true,
    },

    password: {
      type: String,
      required: true,
      select: false,
    },

    isEmailVerified: {
      type: Boolean,
      default: false,
    },

    isPhoneVerified: {
      type: Boolean,
      default: false,
    },

    role: {
      type: String,
      enum: [
        'farmer',
        'trader',
        'cold-storage',
        'cold-storage-manager',
        'aloo-mitra',
        'admin',
        'master',
      ],
      default: 'farmer',
    },

    // Manager fields - if this user is assigned as a manager
    managedColdStorage: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ColdStorage',
      default: null,
    },

    managedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    isMaster: {
      type: Boolean,
      default: false,
    },

    subRole: {
      type: String,
      enum: [
        'fertilizers',
        'majdoor',
        'seed-provider',
        'potato-seeds',
        'machinery-rent',
        'transportation',
        'gunny-bag',
        null,
      ],
      default: null,
    },

    // Aloo Mitra (Service Provider) fields
    alooMitraProfile: {
      serviceType: {
        type: String,
        enum: [
          'potato-seeds',
          'fertilizers',
          'machinery-rent',
          'transportation',
          'gunny-bag',
          'majdoor',
          null,
        ],
        default: null,
      },
      businessName: {
        type: String,
        default: '',
      },
      businessAddress: {
        type: String,
        default: '',
      },
      businessLocation: {
        latitude: {
          type: Number,
          default: null,
        },
        longitude: {
          type: Number,
          default: null,
        },
      },
      businessPincode: {
        type: String,
        default: '',
      },
      pricing: {
        type: String,
        default: '',
      },
      description: {
        type: String,
        default: '',
      },
      isVerified: {
        type: Boolean,
        default: false,
      },
      rating: {
        type: Number,
        default: 0,
      },
      totalRatings: {
        type: Number,
        default: 0,
      },
      // Majdoor-specific fields
      majdoorMobile: {
        type: String,
        default: '',
      },
      kaamType: {
        type: String,
        enum: ['aloo-chhantai', 'bori-bharai', 'loading', 'cold-storage', null],
        default: null,
      },
      kaamJagah: {
        type: String,
        enum: ['gaon', 'mandi', 'cold-storage', null],
        default: null,
      },
      availability: {
        type: String,
        enum: ['daily', 'seasonal', null],
        default: null,
      },
      aadhaarImageUrl: {
        type: String,
        default: '',
      },
      // Gunny Bag-specific fields
      gunnyBagBusinessName: {
        type: String,
        default: '',
      },
      gunnyBagOwnerName: {
        type: String,
        default: '',
      },
      // Machinery-specific fields
      machineryBusinessName: {
        type: String,
        default: '',
      },
      machineType: {
        type: String,
        enum: ['other', 'tractor', 'rotavator', 'planter', 'sprayer', 'harvester', null],
        default: null,
      },
      machineryServiceType: {
        type: String,
        enum: ['new-sale', 'rent', 'both', null],
        default: null,
      },
      rentType: {
        type: String,
        enum: ['per-hour', 'per-day', null],
        default: null,
      },
      salePriceMin: {
        type: Number,
        default: null,
      },
      salePriceMax: {
        type: Number,
        default: null,
      },
      rentPriceMin: {
        type: Number,
        default: null,
      },
      rentPriceMax: {
        type: Number,
        default: null,
      },
      // Business photos (stored as base64 strings)
      businessPhotos: {
        type: [String],
        default: [],
      },
    },

    address: {
      village: {
        type: String,
        default: '',
      },
      district: {
        type: String,
        default: '',
      },
      state: {
        type: String,
        default: '',
      },
      pincode: {
        type: String,
        default: '',
      },
    },

    // Subscription fields
    currentPlan: {
      type: String,
      enum: ['free', 'seasonal', 'yearly'],
      default: 'free',
    },

    subscriptionEndDate: {
      type: Date,
      default: null,
    },

    // KYC / Aadhaar verification fields
    kyc: {
      aadhaarNumber: {
        type: String, // stored encrypted (last 4 digits only in plain for masking)
        default: '',
      },
      aadhaarLast4: {
        type: String,
        default: '',
      },
      aadhaarPhotoUrl: {
        type: String,
        default: '',
      },
      status: {
        type: String,
        enum: ['not_started', 'otp_sent', 'verified', 'failed'],
        default: 'not_started',
      },
      verifiedAt: {
        type: Date,
        default: null,
      },
      otpTransactionId: {
        type: String,
        default: '',
      },
      otpExpiresAt: {
        type: Date,
        default: null,
      },
      otpAttempts: {
        type: Number,
        default: 0,
      },
      providerRefId: {
        type: String,
        default: '',
      },
    },

    refreshToken: {
      type: String,
    },

    // FCM push notification token (one per device)
    fcmToken: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
); // Adds createdAt and updatedAt fields

// genarate accesstoken

user_schema.methods.genreateAccessToken = async function () {
  return await jwt.sign({ _id: this._id }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1d' });
};

// genrate refresh token

user_schema.methods.genrateRefreshToken = async function () {
  return await jwt.sign({ _id: this._id }, process.env.REFRESS_TOKEN_SECRET, { expiresIn: '10m' });
};

// password hashing

user_schema.pre('save', async function () {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, 8);
});

// compare password

user_schema.methods.isPasswordMatch = async function (password) {
  return bcrypt.compare(password, this.password);
};

const User = new mongoose.model('User', user_schema);

export { User };
