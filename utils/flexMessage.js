// utils/flexMessage.js
// Flex Message templates for LINE Bot Push notifications.
// Each builder returns a complete LINE Messaging API message object.

const LIFF_ID = process.env.LIFF_ID;
const BRAND_PRIMARY = '#0E7C66';   // AiKlao green
const BRAND_WARNING = '#E89B23';   // AiKlao amber
const TEXT_SECONDARY = '#6B7280';

/**
 * Trip detail Flex Message with 2 action buttons:
 *  - Open in LINE (LIFF URL)
 *  - Open in AiKlao Mobile (custom URI scheme)
 *
 * @param {object} params
 * @param {string} params.tripId - trip identifier (passed as query param)
 * @param {string} params.tripName - display name shown in the message
 * @returns {object} LINE Messaging API message
 */
function buildTripDetailFlex({ tripId, tripName }) {
  const liffUrl = `https://liff.line.me/${LIFF_ID}?tripId=${encodeURIComponent(tripId)}`;

  return {
    type: 'flex',
    altText: `AiKlao: ${tripName}`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: `🗺️ ${tripName}`,
            weight: 'bold',
            size: 'lg',
            color: BRAND_PRIMARY,
            wrap: true,
          },
        ],
        paddingBottom: '8px',
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          {
            type: 'text',
            text: 'ติดตามตำแหน่งสมาชิกในทริปได้ทันที',
            wrap: true,
            size: 'sm',
            color: TEXT_SECONDARY,
          },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: BRAND_PRIMARY,
            action: {
              type: 'uri',
              label: 'ดูทริป (LIFF)',
              uri: liffUrl,
            },
          },
        ],
      },
    },
  };
}

/**
 * SOS alert Flex Message (Phase 6.2). Red emergency bubble with a single
 * HTTPS LIFF button (custom schemes are rejected by LINE Push — see
 * Phase 5.6 B+ Flex hotfix).
 *
 * @param {object} params
 * @param {string} params.senderName - display name of the member who fired SOS
 * @param {number} params.lat
 * @param {number} params.lng
 * @param {string} params.timeHHMM - pre-formatted local time (e.g. "13:22")
 * @param {string} params.tripName
 * @param {string} params.tripId
 * @returns {object} LINE Messaging API message
 */
function buildSosFlex({ senderName, lat, lng, timeHHMM, tripName, tripId }) {
  return {
    type: 'flex',
    altText: `🚨 ${senderName} ส่ง SOS — เปิดแอปดูตำแหน่ง`,
    contents: {
      type: 'bubble',
      size: 'kilo',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#DC2626',
        paddingAll: '12px',
        contents: [
          { type: 'text', text: '🚨 SOS ALERT', color: '#FFFFFF', weight: 'bold', size: 'lg' },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          { type: 'text', text: `${senderName} ส่งสัญญาณขอความช่วยเหลือ`, wrap: true, weight: 'bold' },
          { type: 'separator' },
          { type: 'text', text: `📍 ${lat.toFixed(5)}, ${lng.toFixed(5)}`, size: 'sm', color: '#666666' },
          { type: 'text', text: `⏰ ${timeHHMM}`, size: 'sm', color: '#666666' },
          { type: 'text', text: `🚙 ${tripName}`, size: 'sm', color: '#666666' },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: '#DC2626',
            action: {
              type: 'uri',
              label: 'เปิดแผนที่',
              uri: `https://liff.line.me/${LIFF_ID}?path=trip&id=${encodeURIComponent(tripId)}`,
            },
          },
        ],
      },
    },
  };
}

module.exports = {
  buildTripDetailFlex,
  buildSosFlex,
};
