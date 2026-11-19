function doPost(e) {
  try {
    const senderAddress = 'app@tenx.jp';
    const request = JSON.parse((e.postData && e.postData.contents) || '{}');
    const expectedSecret = PropertiesService.getScriptProperties().getProperty('GMAIL_RELAY_SECRET');
    if (!expectedSecret || request.secret !== expectedSecret) {
      return jsonResponse({ ok: false, error: 'Unauthorized' });
    }

    if (!request.to || !request.subject || !request.html) {
      return jsonResponse({ ok: false, error: 'Missing required fields' });
    }

    const inlineImages = {};
    (request.inlineImages || []).forEach(function(image) {
      inlineImages[image.cid] = Utilities.newBlob(
        Utilities.base64Decode(image.base64),
        image.mimeType,
        image.filename
      );
    });

    const attachments = (request.attachments || []).map(function(file) {
      return Utilities.newBlob(
        Utilities.base64Decode(file.base64),
        file.mimeType,
        file.filename
      );
    });

    if (GmailApp.getAliases().indexOf(senderAddress) === -1) {
      return jsonResponse({
        ok: false,
        error: 'Sender alias is not available: ' + senderAddress,
      });
    }

    GmailApp.sendEmail(request.to, request.subject, request.text || '10X RFQ notification', {
      htmlBody: request.html,
      inlineImages: inlineImages,
      attachments: attachments,
      from: senderAddress,
      name: request.senderName || '10X Apps',
    });

    return jsonResponse({ ok: true });
  } catch (error) {
    console.error(error);
    return jsonResponse({ ok: false, error: String(error) });
  }
}

function jsonResponse(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
