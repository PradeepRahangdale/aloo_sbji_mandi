import mongoose from "mongoose";

const appSettingsSchema = new mongoose.Schema({
    key: {
        type: String,
        required: true,
        unique: true,
        index: true,
    },
    value: {
        type: mongoose.Schema.Types.Mixed,
        required: true,
    },
    updatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
    },
}, { timestamps: true });

export const AppSettings = mongoose.model("AppSettings", appSettingsSchema);

// Default slide pricing & duration options
export const DEFAULT_SLIDE_PRICING = [
    { slide: 1, label: 'Slide 1', price: 1000 },
    { slide: 2, label: 'Slide 2', price: 800 },
    { slide: 3, label: 'Slide 3', price: 600 },
    { slide: 4, label: 'Slide 4', price: 400 },
    { slide: 5, label: 'Slide 5', price: 200 },
];

export const DEFAULT_DURATION_OPTIONS = [
    { days: 7,  label: '1 Week',    multiplier: 1 },
    { days: 15, label: '15 Days',   multiplier: 2 },
    { days: 30, label: '1 Month',   multiplier: 3 },
    { days: 90, label: '3 Months',  multiplier: 8 },
];
