import express from "express";
import { authMiddleware } from "../middleware/auth.middleware.js";
import { Deal } from "../models/deal.model.js";
import { Listing } from "../models/listing.model.js";

const router = express.Router();

// ─── Vyapari AI Analytics ───────────────────────────────────────────
// GET /api/v1/analytics/vyapari-insights
// Returns all 6 AI insight blocks for the logged-in trader
router.get("/vyapari-insights", authMiddleware, async (req, res) => {
    try {
        const userId = req.user._id;
        const now = new Date();

        // ── 1. Gather raw data in parallel ──
        const [
            userDeals,
            recentListings,
            allSellListings,
            userListings,
        ] = await Promise.all([
            // All deals for this user (as buyer = coldStorageOwner)
            Deal.find({
                $or: [{ coldStorageOwner: userId }, { farmer: userId }],
            })
                .populate("farmer", "firstName lastName")
                .populate("coldStorageOwner", "firstName lastName")
                .sort({ createdAt: -1 })
                .limit(100)
                .lean(),

            // Last 7 days sell listings (market-wide)
            Listing.find({
                type: "sell",
                isActive: true,
                createdAt: { $gte: new Date(now - 7 * 86400000) },
            })
                .sort({ createdAt: -1 })
                .limit(200)
                .lean(),

            // Last 30 days sell listings (for trend)
            Listing.find({
                type: "sell",
                createdAt: { $gte: new Date(now - 30 * 86400000) },
            })
                .sort({ createdAt: -1 })
                .limit(500)
                .lean(),

            // User's own buy listings
            Listing.find({ seller: userId, type: "buy" })
                .sort({ createdAt: -1 })
                .limit(50)
                .lean(),
        ]);

        // ── 2. Calculate metrics ──
        const closedDeals = userDeals.filter((d) => d.status === "closed");
        const activeDeals = userDeals.filter(
            (d) =>
                d.status === "proposed" ||
                d.status === "farmer_confirmed" ||
                d.status === "owner_confirmed"
        );

        // Average prices
        const recentPrices = recentListings
            .map((l) => l.pricePerQuintal)
            .filter((p) => p > 0);
        const avgMarketPrice =
            recentPrices.length > 0
                ? Math.round(
                      recentPrices.reduce((a, b) => a + b, 0) /
                          recentPrices.length
                  )
                : 1200;

        const allPrices30d = allSellListings
            .map((l) => l.pricePerQuintal)
            .filter((p) => p > 0);
        const avgPrice30d =
            allPrices30d.length > 0
                ? Math.round(
                      allPrices30d.reduce((a, b) => a + b, 0) /
                          allPrices30d.length
                  )
                : 1200;

        // Week 1 vs Week 2 trend
        const week1Listings = allSellListings.filter(
            (l) => new Date(l.createdAt) >= new Date(now - 7 * 86400000)
        );
        const week2Listings = allSellListings.filter(
            (l) =>
                new Date(l.createdAt) >= new Date(now - 14 * 86400000) &&
                new Date(l.createdAt) < new Date(now - 7 * 86400000)
        );

        const week1Avg =
            week1Listings.length > 0
                ? week1Listings.reduce((s, l) => s + l.pricePerQuintal, 0) /
                  week1Listings.length
                : avgMarketPrice;
        const week2Avg =
            week2Listings.length > 0
                ? week2Listings.reduce((s, l) => s + l.pricePerQuintal, 0) /
                  week2Listings.length
                : avgMarketPrice;

        const priceChangePercent =
            week2Avg > 0
                ? (((week1Avg - week2Avg) / week2Avg) * 100).toFixed(1)
                : 0;

        // Demand: count of buy listings in last 7 days vs previous 7 days
        const recentBuyListings = allSellListings.filter(
            (l) =>
                l.type === "buy" &&
                new Date(l.createdAt) >= new Date(now - 7 * 86400000)
        );

        // Season info
        const month = now.getMonth(); // 0-indexed
        const isSowingSeason = month >= 9 && month <= 11; // Oct-Dec
        const isHarvestSeason = month >= 0 && month <= 2; // Jan-Mar
        const isStorageSeason = month >= 3 && month <= 5; // Apr-Jun

        // ── 3. Generate 6 AI Insights ──

        // ─── Insight 1: Rate Prediction ───
        let trendDirection = "Stable";
        let trendConfidence = "Medium";
        let predictedChange = parseFloat(priceChangePercent);

        if (predictedChange > 3) {
            trendDirection = "Rising";
            trendConfidence = Math.abs(predictedChange) > 8 ? "High" : "Medium";
        } else if (predictedChange < -3) {
            trendDirection = "Falling";
            trendConfidence = Math.abs(predictedChange) > 8 ? "High" : "Medium";
        } else {
            trendDirection = "Stable";
            trendConfidence = "Medium";
        }

        // Seasonal boost
        if (isHarvestSeason && trendDirection !== "Falling") {
            trendDirection = "Falling";
            trendConfidence = "High";
            predictedChange = -5;
        }
        if (isSowingSeason && trendDirection !== "Rising") {
            trendConfidence = "Medium";
        }

        const ratePrediction = {
            currentAvgPrice: avgMarketPrice,
            predictedDirection: trendDirection,
            predictedChangePercent: predictedChange,
            confidence: trendConfidence,
            predictedPriceRange: {
                low: Math.round(avgMarketPrice * (1 + predictedChange / 100 - 0.03)),
                high: Math.round(avgMarketPrice * (1 + predictedChange / 100 + 0.03)),
            },
            horizon: "3-7 days",
            reason:
                trendDirection === "Rising"
                    ? "Prices are trending up based on reduced supply and seasonal demand."
                    : trendDirection === "Falling"
                    ? "Harvest season supply is pushing prices down."
                    : "Market is stable with balanced supply and demand.",
            reasonHi:
                trendDirection === "Rising"
                    ? "कम सप्लाई और मौसमी मांग के कारण भाव बढ़ रहे हैं।"
                    : trendDirection === "Falling"
                    ? "फसल कटाई की सप्लाई से भाव गिर रहे हैं।"
                    : "बाजार में सप्लाई और मांग संतुलित है।",
        };

        // ─── Insight 2: Demand Alert ───
        const currentDemandCount = recentListings.length;
        const avgDailyListings = allSellListings.length / 30;
        const currentDailyAvg = currentDemandCount / 7;
        let demandTrend = "Normal";
        let demandAlertLevel = "None";

        if (currentDailyAvg > avgDailyListings * 1.5) {
            demandTrend = "Increasing";
            demandAlertLevel = "High";
        } else if (currentDailyAvg > avgDailyListings * 1.2) {
            demandTrend = "Slightly Increasing";
            demandAlertLevel = "Medium";
        } else if (currentDailyAvg < avgDailyListings * 0.6) {
            demandTrend = "Decreasing";
            demandAlertLevel = "High";
        } else if (currentDailyAvg < avgDailyListings * 0.8) {
            demandTrend = "Slightly Decreasing";
            demandAlertLevel = "Low";
        }

        const demandAlert = {
            trend: demandTrend,
            alertLevel: demandAlertLevel,
            currentListings7d: currentDemandCount,
            avgDailyListings: Math.round(avgDailyListings),
            reason:
                demandTrend === "Increasing"
                    ? "More sellers are listing potatoes than usual — supply is high, negotiate harder."
                    : demandTrend === "Decreasing"
                    ? "Fewer listings than normal — supply is tight, prices may rise."
                    : "Supply is normal for this time of year.",
            reasonHi:
                demandTrend === "Increasing"
                    ? "सामान्य से ज्यादा विक्रेता आलू बेच रहे हैं — सप्लाई ज्यादा है, अच्छे से मोल-भाव करें।"
                    : demandTrend === "Decreasing"
                    ? "सामान्य से कम लिस्टिंग — सप्लाई कम है, भाव बढ़ सकते हैं।"
                    : "इस समय सप्लाई सामान्य है।",
        };

        // ─── Insight 3: Fraud / Risky Deal Alert ───
        const riskyDeals = [];
        for (const deal of activeDeals) {
            const risks = [];
            let riskLevel = "Low";

            // Price deviation check
            if (deal.pricePerTon > 0) {
                const dealPricePerQuintal = deal.pricePerTon / 10; // ton → quintal
                const deviation = Math.abs(
                    ((dealPricePerQuintal - avgMarketPrice) / avgMarketPrice) * 100
                );
                if (deviation > 30) {
                    risks.push(
                        `Price deviates ${Math.round(deviation)}% from market average`
                    );
                    riskLevel = "High";
                } else if (deviation > 15) {
                    risks.push(
                        `Price deviates ${Math.round(deviation)}% from market average`
                    );
                    riskLevel = riskLevel === "High" ? "High" : "Medium";
                }
            }

            // Abnormal quantity
            if (deal.quantity > 500) {
                risks.push("Very large quantity — verify seller capacity");
                riskLevel = riskLevel === "Low" ? "Medium" : riskLevel;
            }

            // New deal partner (few past deals)
            const otherPartyId =
                deal.farmer?._id?.toString() === userId.toString()
                    ? deal.coldStorageOwner?._id
                    : deal.farmer?._id;
            if (otherPartyId) {
                const pastDeals = userDeals.filter(
                    (d) =>
                        d.status === "closed" &&
                        (d.farmer?._id?.toString() === otherPartyId.toString() ||
                            d.coldStorageOwner?._id?.toString() ===
                                otherPartyId.toString())
                );
                if (pastDeals.length === 0) {
                    risks.push("First-time deal partner — verify carefully");
                    riskLevel = riskLevel === "Low" ? "Medium" : riskLevel;
                }
            }

            if (risks.length > 0) {
                const otherPartyName =
                    deal.farmer?._id?.toString() === userId.toString()
                        ? `${deal.coldStorageOwner?.firstName || ""} ${deal.coldStorageOwner?.lastName || ""}`.trim()
                        : `${deal.farmer?.firstName || ""} ${deal.farmer?.lastName || ""}`.trim();

                riskyDeals.push({
                    dealId: deal._id,
                    otherParty: otherPartyName || "Unknown",
                    quantity: deal.quantity,
                    pricePerTon: deal.pricePerTon,
                    riskLevel,
                    risks,
                });
            }
        }

        // ─── Insight 4: Best Buying Time ───
        let buyRecommendation = "Wait";
        let buyReason = "";
        let buyReasonHi = "";

        if (trendDirection === "Falling") {
            buyRecommendation = "Wait";
            buyReason = "Prices are falling. Wait 3-5 days for better rates.";
            buyReasonHi = "भाव गिर रहे हैं। 3-5 दिन रुकें, और अच्छे रेट मिलेंगे।";
        } else if (trendDirection === "Rising") {
            if (parseFloat(priceChangePercent) > 8) {
                buyRecommendation = "Buy Now";
                buyReason = "Prices rising fast. Buy now before they go higher.";
                buyReasonHi = "भाव तेजी से बढ़ रहे हैं। अभी खरीदें, और बढ़ेंगे।";
            } else {
                buyRecommendation = "Buy in Small Quantity";
                buyReason =
                    "Prices rising slowly. Buy partial stock now, rest later.";
                buyReasonHi =
                    "भाव धीरे-धीरे बढ़ रहे हैं। कुछ अभी खरीदें, बाकी बाद में।";
            }
        } else {
            // Stable
            if (isHarvestSeason) {
                buyRecommendation = "Buy Now";
                buyReason = "Harvest season — best time to buy at lowest prices.";
                buyReasonHi = "फसल कटाई सीजन — सबसे कम दाम, अभी खरीदें।";
            } else if (isStorageSeason) {
                buyRecommendation = "Buy in Small Quantity";
                buyReason =
                    "Stock-up season. Buy gradually as cold storage supply comes out.";
                buyReasonHi =
                    "भंडारण सीजन। धीरे-धीरे खरीदें, कोल्ड स्टोरेज से माल आ रहा है।";
            } else {
                buyRecommendation = "Wait";
                buyReason = "Prices stable. No urgency to buy right now.";
                buyReasonHi = "भाव स्थिर है। अभी जल्दी करने की जरूरत नहीं।";
            }
        }

        const bestBuyingTime = {
            recommendation: buyRecommendation,
            reason: buyReason,
            reasonHi: buyReasonHi,
            currentPrice: avgMarketPrice,
            trendDirection,
            season: isSowingSeason
                ? "Sowing"
                : isHarvestSeason
                ? "Harvest"
                : isStorageSeason
                ? "Storage"
                : "Off-Season",
        };

        // ─── Insight 5: Price Negotiation Suggestion ───
        const floorPrice = Math.round(avgMarketPrice * 0.88);
        const ceilingPrice = Math.round(avgMarketPrice * 0.97);
        const idealPrice = Math.round(avgMarketPrice * 0.92);

        const negotiation = {
            marketAvgPrice: avgMarketPrice,
            idealBuyPrice: idealPrice,
            floorPrice: floorPrice,
            ceilingPrice: ceilingPrice,
            tip:
                trendDirection === "Falling"
                    ? "Market is soft — push for floor price. Sellers are eager."
                    : trendDirection === "Rising"
                    ? "Market is strong — offer ceiling price to close deals fast."
                    : "Market is fair — aim for ideal price, it's a sweet spot.",
            tipHi:
                trendDirection === "Falling"
                    ? "बाजार नरम है — फ्लोर प्राइस पर जोर दें। विक्रेता बेचने को तैयार हैं।"
                    : trendDirection === "Rising"
                    ? "बाजार मजबूत है — जल्दी सौदा करने के लिए सीलिंग प्राइस ऑफर करें।"
                    : "बाजार ठीक है — आइडियल प्राइस पर बात करें, यह सबसे अच्छा है।",
        };

        // ─── Insight 6: Trader Performance ───
        const totalDeals = closedDeals.length;
        let avgMargin = 0;
        let totalProfit = 0;
        let bestDeal = null;
        let worstDeal = null;

        if (totalDeals > 0) {
            for (const deal of closedDeals) {
                const margin = ((avgMarketPrice - deal.pricePerTon / 10) / avgMarketPrice) * 100;
                totalProfit += margin;
                if (!bestDeal || margin > bestDeal.margin)
                    bestDeal = { deal, margin };
                if (!worstDeal || margin < worstDeal.margin)
                    worstDeal = { deal, margin };
            }
            avgMargin = (totalProfit / totalDeals).toFixed(1);
        }

        // Buying patterns
        const dealsByMonth = {};
        for (const deal of closedDeals) {
            const m = new Date(deal.createdAt).getMonth();
            dealsByMonth[m] = (dealsByMonth[m] || 0) + 1;
        }
        const bestMonth = Object.entries(dealsByMonth).sort(
            (a, b) => b[1] - a[1]
        )[0];
        const monthNames = [
            "Jan", "Feb", "Mar", "Apr", "May", "Jun",
            "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
        ];

        const tips = [];
        const tipsHi = [];
        if (parseFloat(avgMargin) < 5) {
            tips.push("Your margins are thin. Try buying at floor price during harvest season.");
            tipsHi.push("आपका मार्जिन कम है। फसल कटाई सीजन में फ्लोर प्राइस पर खरीदें।");
        }
        if (totalDeals < 5) {
            tips.push("Build more trade history to unlock better AI insights.");
            tipsHi.push("बेहतर AI सुझावों के लिए और ज्यादा सौदे करें।");
        }
        if (totalDeals >= 5 && parseFloat(avgMargin) >= 5) {
            tips.push("Strong track record! Consider increasing your deal volume.");
            tipsHi.push("बढ़िया ट्रैक रिकॉर्ड! अपने सौदों की मात्रा बढ़ाएं।");
        }
        if (riskyDeals.length > 0) {
            tips.push("You have risky deals active. Verify all new partners before confirming.");
            tipsHi.push("आपके कुछ सौदे जोखिम भरे हैं। नए पार्टनर की पुष्टि करें।");
        }

        const performance = {
            totalDeals,
            activeDeals: activeDeals.length,
            avgMarginPercent: parseFloat(avgMargin),
            totalProfit: Math.round(totalProfit),
            bestBuyingMonth: bestMonth ? monthNames[parseInt(bestMonth[0])] : "N/A",
            tips,
            tipsHi,
        };

        // ── 4. Return all insights ──
        res.json({
            success: true,
            data: {
                ratePrediction,
                demandAlert,
                riskyDeals,
                bestBuyingTime,
                negotiation,
                performance,
                meta: {
                    generatedAt: now.toISOString(),
                    dataPoints: {
                        dealsAnalyzed: userDeals.length,
                        listingsScanned: allSellListings.length,
                    },
                },
            },
        });
    } catch (error) {
        console.error("Vyapari analytics error:", error);
        res.status(500).json({
            success: false,
            message: "Failed to generate analytics",
            error: error.message,
        });
    }
});

export default router;
