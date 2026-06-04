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

module.exports = {
  buildTripDetailFlex,
};
