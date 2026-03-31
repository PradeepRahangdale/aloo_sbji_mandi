import mongoose from "mongoose";
import bcrypt from "bcrypt";
import { User } from "../models/user.model.js";
import { ColdStorage } from "../models/coldStorage.model.js";
import { Post } from "../models/post.model.js";
import { Listing } from "../models/listing.model.js";
import { dbConnection } from "./dbConnection.js";
import dotenv from "dotenv";

dotenv.config();

const seedData = async () => {
    try {
        await dbConnection();
        console.log("🌱 Starting seed process...\n");

        // Clear existing data (optional - comment out if you want to keep existing data)
        // await User.deleteMany({});
        // await ColdStorage.deleteMany({});
        // await Post.deleteMany({});
        // await Listing.deleteMany({});
        // console.log("✅ Cleared existing data");

        const hashedPassword = await bcrypt.hash("password123", 10);

        // ==================== FARMERS ====================
        const farmers = [
            {
                firstName: "Ramu",
                lastName: "Kisan",
                phone: "9876543210",
                password: hashedPassword,
                role: "farmer",
                isPhoneVerified: true,
                address: { village: "Gazipur", district: "Agra", state: "Uttar Pradesh", pincode: "282001" }
            },
            {
                firstName: "Shyam",
                lastName: "Yadav",
                phone: "9876543211",
                password: hashedPassword,
                role: "farmer",
                isPhoneVerified: true,
                address: { village: "Mathura Road", district: "Mathura", state: "Uttar Pradesh", pincode: "281001" }
            },
            {
                firstName: "Mohan",
                lastName: "Singh",
                phone: "9876543212",
                password: hashedPassword,
                role: "farmer",
                isPhoneVerified: true,
                address: { village: "Sirhind", district: "Fatehgarh Sahib", state: "Punjab", pincode: "140406" }
            },
            {
                firstName: "Ramesh",
                lastName: "Patel",
                phone: "9876543213",
                password: hashedPassword,
                role: "farmer",
                isPhoneVerified: true,
                address: { village: "Deesa", district: "Banaskantha", state: "Gujarat", pincode: "385535" }
            },
            {
                firstName: "Suresh",
                lastName: "Kumar",
                phone: "9876543214",
                password: hashedPassword,
                role: "farmer",
                isPhoneVerified: true,
                address: { village: "Hooghly", district: "Hooghly", state: "West Bengal", pincode: "712101" }
            }
        ];

        // ==================== TRADERS/VENDORS ====================
        const traders = [
            {
                firstName: "Vikram",
                lastName: "Agarwal",
                phone: "9888888801",
                password: hashedPassword,
                role: "trader",
                isPhoneVerified: true,
                address: { village: "Azadpur Mandi", district: "North Delhi", state: "Delhi", pincode: "110033" }
            },
            {
                firstName: "Rajesh",
                lastName: "Gupta",
                phone: "9888888802",
                password: hashedPassword,
                role: "trader",
                isPhoneVerified: true,
                address: { village: "Ghazipur Mandi", district: "East Delhi", state: "Delhi", pincode: "110096" }
            },
            {
                firstName: "Anil",
                lastName: "Sharma",
                phone: "9888888803",
                password: hashedPassword,
                role: "trader",
                isPhoneVerified: true,
                address: { village: "Vashi APMC", district: "Navi Mumbai", state: "Maharashtra", pincode: "400703" }
            },
            {
                firstName: "Sunil",
                lastName: "Jain",
                phone: "9888888804",
                password: hashedPassword,
                role: "trader",
                isPhoneVerified: true,
                address: { village: "Jamalpur", district: "Ahmedabad", state: "Gujarat", pincode: "380001" }
            }
        ];

        // ==================== COLD STORAGE OWNERS ====================
        const coldStorageOwners = [
            {
                firstName: "Manoj",
                lastName: "Verma",
                phone: "9777777701",
                password: hashedPassword,
                role: "cold-storage",
                isPhoneVerified: true,
                address: { village: "Industrial Area", district: "Agra", state: "Uttar Pradesh", pincode: "282007" }
            },
            {
                firstName: "Prakash",
                lastName: "Tiwari",
                phone: "9777777702",
                password: hashedPassword,
                role: "cold-storage",
                isPhoneVerified: true,
                address: { village: "GIDC", district: "Deesa", state: "Gujarat", pincode: "385535" }
            },
            {
                firstName: "Harpal",
                lastName: "Singh",
                phone: "9777777703",
                password: hashedPassword,
                role: "cold-storage",
                isPhoneVerified: true,
                address: { village: "Focal Point", district: "Jalandhar", state: "Punjab", pincode: "144004" }
            },
            {
                firstName: "Biswajit",
                lastName: "Das",
                phone: "9777777704",
                password: hashedPassword,
                role: "cold-storage",
                isPhoneVerified: true,
                address: { village: "Dankuni", district: "Hooghly", state: "West Bengal", pincode: "712310" }
            }
        ];

        // Insert Users
        const insertedFarmers = await User.insertMany(farmers, { ordered: false }).catch(e => {
            console.log("Some farmers may already exist, skipping duplicates...");
            return [];
        });
        const insertedTraders = await User.insertMany(traders, { ordered: false }).catch(e => {
            console.log("Some traders may already exist, skipping duplicates...");
            return [];
        });
        const insertedOwners = await User.insertMany(coldStorageOwners, { ordered: false }).catch(e => {
            console.log("Some cold storage owners may already exist, skipping duplicates...");
            return [];
        });

        console.log(`✅ Created ${insertedFarmers.length} farmers`);
        console.log(`✅ Created ${insertedTraders.length} traders`);
        console.log(`✅ Created ${insertedOwners.length} cold storage owners`);

        // Get all users for reference
        const allFarmers = await User.find({ role: "farmer" });
        const allTraders = await User.find({ role: "trader" });
        const allOwners = await User.find({ role: "cold-storage" });

        // ==================== COLD STORAGES ====================
        if (allOwners.length > 0) {
            const coldStorages = [
                {
                    owner: allOwners[0]?._id,
                    name: "Verma Cold Storage",
                    address: "Industrial Area, Agra Road",
                    city: "Agra",
                    state: "Uttar Pradesh",
                    pincode: "282007",
                    phone: "9777777701",
                    email: "verma.cold@example.com",
                    capacity: 5000,
                    availableCapacity: 2500,
                    pricePerTon: 450,
                    isAvailable: true
                },
                {
                    owner: allOwners[0]?._id,
                    name: "Agra Ice Factory & Cold Storage",
                    address: "Near NH-2, Sikandra",
                    city: "Agra",
                    state: "Uttar Pradesh",
                    pincode: "282007",
                    phone: "9777777711",
                    email: "agra.ice@example.com",
                    capacity: 8000,
                    availableCapacity: 3200,
                    pricePerTon: 500,
                    isAvailable: true
                },
                {
                    owner: allOwners[1]?._id || allOwners[0]?._id,
                    name: "Gujarat Agro Cold Storage",
                    address: "GIDC Phase 2, Deesa",
                    city: "Deesa",
                    state: "Gujarat",
                    pincode: "385535",
                    phone: "9777777702",
                    email: "gujarat.agro@example.com",
                    capacity: 10000,
                    availableCapacity: 6500,
                    pricePerTon: 400,
                    isAvailable: true
                },
                {
                    owner: allOwners[2]?._id || allOwners[0]?._id,
                    name: "Punjab Potato Store",
                    address: "Focal Point, Industrial Area",
                    city: "Jalandhar",
                    state: "Punjab",
                    pincode: "144004",
                    phone: "9777777703",
                    email: "punjab.potato@example.com",
                    capacity: 7500,
                    availableCapacity: 1500,
                    pricePerTon: 480,
                    isAvailable: true
                },
                {
                    owner: allOwners[3]?._id || allOwners[0]?._id,
                    name: "Bengal Cold Chain",
                    address: "NH-2, Dankuni Industrial Complex",
                    city: "Hooghly",
                    state: "West Bengal",
                    pincode: "712310",
                    phone: "9777777704",
                    email: "bengal.cold@example.com",
                    capacity: 12000,
                    availableCapacity: 8000,
                    pricePerTon: 380,
                    isAvailable: true
                },
                {
                    owner: allOwners[0]?._id,
                    name: "Mathura Aloo Bhandar",
                    address: "Near Krishna Janmabhoomi Road",
                    city: "Mathura",
                    state: "Uttar Pradesh",
                    pincode: "281001",
                    phone: "9777777705",
                    email: "mathura.aloo@example.com",
                    capacity: 4000,
                    availableCapacity: 0,
                    pricePerTon: 520,
                    isAvailable: false
                }
            ];

            const insertedStorages = await ColdStorage.insertMany(coldStorages, { ordered: false }).catch(e => {
                console.log("Some cold storages may already exist...");
                return [];
            });
            console.log(`✅ Created ${insertedStorages.length} cold storages`);
        }

        // ==================== POSTS ====================
        const allUsers = [...allFarmers, ...allTraders, ...allOwners];
        if (allUsers.length > 0) {
            const posts = [
                {
                    author: allFarmers[0]?._id || allUsers[0]._id,
                    content: "🥔 इस साल आलू की फसल बहुत अच्छी हुई है! 50 क्विंटल प्रति एकड़ उपज मिली। किसान भाइयों, आप सबको भी बढ़िया फसल की शुभकामनाएं!",
                    category: "general",
                    likes: [allUsers[1]?._id, allUsers[2]?._id].filter(Boolean),
                    comments: [
                        { user: allTraders[0]?._id || allUsers[1]?._id, text: "बहुत बढ़िया! क्या भाव चल रहा है?" }
                    ]
                },
                {
                    author: allTraders[0]?._id || allUsers[0]._id,
                    content: "📊 आज का मंडी भाव - आगरा: ₹1850/क्विंटल, दिल्ली आजादपुर: ₹2100/क्विंटल, जालंधर: ₹1950/क्विंटल। Pukhraj variety की demand ज्यादा है।",
                    category: "price-update",
                    likes: [allFarmers[0]?._id, allFarmers[1]?._id, allFarmers[2]?._id].filter(Boolean)
                },
                {
                    author: allFarmers[1]?._id || allUsers[0]._id,
                    content: "❓ भाइयों, कोई बता सकता है कि आलू में झुलसा रोग (Late Blight) का इलाज कैसे करें? पत्तियों पर भूरे धब्बे आ रहे हैं।",
                    category: "question",
                    comments: [
                        { user: allFarmers[2]?._id, text: "Mancozeb 75% WP का छिड़काव करो, 2.5 ग्राम प्रति लीटर पानी में" },
                        { user: allFarmers[0]?._id, text: "Ridomil Gold भी अच्छा काम करता है" }
                    ]
                },
                {
                    author: allOwners[0]?._id || allUsers[0]._id,
                    content: "❄️ हमारे cold storage में अभी 2500 टन जगह खाली है। ₹450/टन/महीना। संपर्क करें: 9777777701",
                    category: "general"
                },
                {
                    author: allFarmers[2]?._id || allUsers[0]._id,
                    content: "💡 TIP: आलू की खुदाई के बाद उसे 2-3 दिन छाया में सुखाना चाहिए। इससे storage life बढ़ती है और कटने-छिलने से होने वाला नुकसान कम होता है।",
                    category: "tip",
                    likes: [allFarmers[0]?._id, allFarmers[1]?._id, allTraders[0]?._id].filter(Boolean)
                },
                {
                    author: allTraders[1]?._id || allUsers[0]._id,
                    content: "🚛 दिल्ली से मुंबई के लिए 20 टन आलू का load चाहिए। Transport available है। Rate: ₹2000/क्विंटल (delivered)। Contact: 9888888802",
                    category: "general"
                },
                {
                    author: allFarmers[3]?._id || allUsers[0]._id,
                    content: "📰 NEWS: गुजरात सरकार ने आलू किसानों के लिए ₹200/क्विंटल का बोनस घोषित किया। MSP के ऊपर मिलेगा यह बोनस!",
                    category: "news",
                    likes: [allFarmers[0]?._id, allFarmers[1]?._id, allFarmers[2]?._id, allTraders[0]?._id].filter(Boolean)
                },
                {
                    author: allFarmers[4]?._id || allUsers[0]._id,
                    content: "🌱 इस बार Kufri Jyoti variety लगाई थी। Quality A-grade निकली। अगले साल और ज्यादा area में लगाऊंगा।",
                    category: "general"
                }
            ];

            const insertedPosts = await Post.insertMany(posts, { ordered: false }).catch(e => {
                console.log("Some posts may already exist...");
                return [];
            });
            console.log(`✅ Created ${insertedPosts.length} posts`);
        }

        // ==================== LISTINGS ====================
        if (allFarmers.length > 0 || allTraders.length > 0) {
            const listings = [
                {
                    seller: allFarmers[0]?._id || allUsers[0]._id,
                    type: "sell",
                    potatoVariety: "Pukhraj",
                    quantity: 200,
                    pricePerQuintal: 1800,
                    description: "ताजा खुदाई का आलू, A-grade quality, बड़े साइज़। Direct खेत से।",
                    location: { village: "Gazipur", district: "Agra", state: "Uttar Pradesh", pincode: "282001" },
                    qualityGrade: "A",
                    isActive: true
                },
                {
                    seller: allFarmers[1]?._id || allUsers[0]._id,
                    type: "sell",
                    potatoVariety: "Kufri Jyoti",
                    quantity: 150,
                    pricePerQuintal: 1650,
                    description: "Cold storage से निकाला हुआ। Chips बनाने के लिए best quality।",
                    location: { village: "Mathura Road", district: "Mathura", state: "Uttar Pradesh", pincode: "281001" },
                    qualityGrade: "A",
                    isActive: true
                },
                {
                    seller: allFarmers[2]?._id || allUsers[0]._id,
                    type: "sell",
                    potatoVariety: "Kufri Chipsona",
                    quantity: 500,
                    pricePerQuintal: 2200,
                    description: "Processing grade potato, dry matter 22%+. Chips और French fries के लिए ideal।",
                    location: { village: "Sirhind", district: "Fatehgarh Sahib", state: "Punjab", pincode: "140406" },
                    qualityGrade: "A",
                    isActive: true
                },
                {
                    seller: allTraders[0]?._id || allUsers[0]._id,
                    type: "buy",
                    potatoVariety: "Any",
                    quantity: 1000,
                    pricePerQuintal: 1900,
                    description: "A-grade आलू खरीदना है, कोई भी variety चलेगी। Delhi delivery पर।",
                    location: { village: "Azadpur Mandi", district: "North Delhi", state: "Delhi", pincode: "110033" },
                    qualityGrade: "A",
                    isActive: true
                },
                {
                    seller: allTraders[1]?._id || allUsers[0]._id,
                    type: "buy",
                    potatoVariety: "Pukhraj",
                    quantity: 500,
                    pricePerQuintal: 2000,
                    description: "Export quality Pukhraj चाहिए। Size: 50mm+, No cuts, No greening।",
                    location: { village: "Ghazipur Mandi", district: "East Delhi", state: "Delhi", pincode: "110096" },
                    qualityGrade: "A",
                    isActive: true
                },
                {
                    seller: allFarmers[3]?._id || allUsers[0]._id,
                    type: "sell",
                    potatoVariety: "Lady Rosetta",
                    quantity: 300,
                    pricePerQuintal: 2400,
                    description: "Premium processing variety। Chips companies के contract के लिए उपलब्ध।",
                    location: { village: "Deesa", district: "Banaskantha", state: "Gujarat", pincode: "385535" },
                    qualityGrade: "A",
                    isActive: true
                },
                {
                    seller: allFarmers[4]?._id || allUsers[0]._id,
                    type: "sell",
                    potatoVariety: "Kufri Jyoti",
                    quantity: 400,
                    pricePerQuintal: 1550,
                    description: "B-grade potato, table purpose के लिए। छोटे साइज़, लेकिन quality अच्छी।",
                    location: { village: "Hooghly", district: "Hooghly", state: "West Bengal", pincode: "712101" },
                    qualityGrade: "B",
                    isActive: true
                },
                {
                    seller: allTraders[2]?._id || allUsers[0]._id,
                    type: "buy",
                    potatoVariety: "Any",
                    quantity: 2000,
                    pricePerQuintal: 1750,
                    description: "Maharashtra markets के लिए bulk quantity चाहिए। Regular supply।",
                    location: { village: "Vashi APMC", district: "Navi Mumbai", state: "Maharashtra", pincode: "400703" },
                    qualityGrade: "B",
                    isActive: true
                }
            ];

            const insertedListings = await Listing.insertMany(listings, { ordered: false }).catch(e => {
                console.log("Some listings may already exist...");
                return [];
            });
            console.log(`✅ Created ${insertedListings.length} listings`);
        }

        console.log("\n🎉 Seed completed successfully!");
        console.log("\n📋 Test Credentials (password: password123):");
        console.log("   Farmers: 9876543210, 9876543211, 9876543212, 9876543213, 9876543214");
        console.log("   Traders: 9888888801, 9888888802, 9888888803, 9888888804");
        console.log("   Cold Storage: 9777777701, 9777777702, 9777777703, 9777777704");

        process.exit(0);
    } catch (error) {
        console.error("❌ Seed failed:", error);
        process.exit(1);
    }
};

seedData();
