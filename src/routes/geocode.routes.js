import express from 'express';

const router = express.Router();

/**
 * POST /api/v1/geocode/reverse
 * Reverse geocode: Convert latitude/longitude → human-readable address
 * Uses Google Geocoding API (server-side proxy to keep API key secure)
 *
 * Body: { latitude: number, longitude: number }
 * Returns: { success: true, data: { address, formattedAddress, locality, district, state, pincode, country } }
 */
router.post('/reverse', async (req, res) => {
  try {
    const { latitude, longitude } = req.body;

    if (!latitude || !longitude) {
      return res.status(400).json({
        success: false,
        message: 'latitude and longitude are required',
      });
    }

    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        success: false,
        message: 'Google API key not configured on server',
      });
    }

    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${latitude},${longitude}&key=${apiKey}&language=en`;

    const response = await fetch(url);
    const data = await response.json();

    if (data.status !== 'OK' || !data.results || data.results.length === 0) {
      return res.status(400).json({
        success: false,
        message: `Geocoding failed: ${data.status}`,
        error_message: data.error_message || null,
      });
    }

    // Parse the best result
    const result = data.results[0];
    const components = result.address_components || [];

    // Extract structured address components
    const getComponent = (type) => {
      const comp = components.find((c) => c.types.includes(type));
      return comp ? comp.long_name : '';
    };

    const getComponentShort = (type) => {
      const comp = components.find((c) => c.types.includes(type));
      return comp ? comp.short_name : '';
    };

    const addressData = {
      formattedAddress: result.formatted_address || '',
      // Build a compact address for display
      address: _buildCompactAddress(components),
      // Individual components
      locality: getComponent('locality') || getComponent('sublocality_level_1') || '',
      subLocality: getComponent('sublocality') || getComponent('sublocality_level_1') || '',
      district:
        getComponent('administrative_area_level_3') ||
        getComponent('administrative_area_level_2') ||
        '',
      state: getComponent('administrative_area_level_1') || '',
      pincode: getComponent('postal_code') || '',
      country: getComponent('country') || '',
      // Raw lat/lng for verification
      latitude: parseFloat(latitude),
      longitude: parseFloat(longitude),
      // Place ID for future use
      placeId: result.place_id || '',
    };

    res.status(200).json({
      success: true,
      data: addressData,
    });
  } catch (error) {
    console.error('Geocoding error:', error.message);
    res.status(500).json({
      success: false,
      message: `Geocoding error: ${error.message}`,
    });
  }
});

/**
 * GET /api/v1/geocode/static-map-url
 * Generate a Google Static Maps URL for a given lat/lng
 * Query params: lat, lng, zoom (default 15), size (default 600x300)
 * Returns: { success: true, data: { mapUrl } }
 */
router.get('/static-map-url', (req, res) => {
  try {
    const { lat, lng, zoom = 15, size = '600x300' } = req.query;

    if (!lat || !lng) {
      return res.status(400).json({
        success: false,
        message: 'lat and lng query params are required',
      });
    }

    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        success: false,
        message: 'Google API key not configured on server',
      });
    }

    const mapUrl =
      `https://maps.googleapis.com/maps/api/staticmap?` +
      `center=${lat},${lng}` +
      `&zoom=${zoom}` +
      `&size=${size}` +
      `&maptype=roadmap` +
      `&markers=color:red%7C${lat},${lng}` +
      `&key=${apiKey}`;

    res.status(200).json({
      success: true,
      data: { mapUrl },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

/**
 * GET /api/v1/geocode/api-key
 * Returns the Google API key for client-side static map rendering
 * (Needed for Flutter to construct static map URLs directly)
 */
router.get('/api-key', (req, res) => {
  try {
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        success: false,
        message: 'Google API key not configured',
      });
    }

    res.status(200).json({
      success: true,
      data: { apiKey },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Helper: Build compact human-readable address from address components
function _buildCompactAddress(components) {
  const getComponent = (type) => {
    const comp = components.find((c) => c.types.includes(type));
    return comp ? comp.long_name : '';
  };

  const parts = [
    getComponent('sublocality_level_1') || getComponent('sublocality'),
    getComponent('locality'),
    getComponent('administrative_area_level_3') || getComponent('administrative_area_level_2'),
    getComponent('administrative_area_level_1'),
    getComponent('postal_code'),
  ].filter(Boolean);

  // Remove duplicates (when locality == district, etc.)
  const uniqueParts = [...new Set(parts)];
  return uniqueParts.join(', ');
}

export default router;
