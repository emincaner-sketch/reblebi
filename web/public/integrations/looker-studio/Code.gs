/**
 * Reblebi → Looker Studio topluluk bağlayıcısı.
 * Kurulum: integrations/looker-studio/README.md
 *
 * Veri kaynağı: GET {sunucu}/api/export/daily?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Kimlik: Reblebi API anahtarı (Ayarlar > API anahtarları), "Authorization: Bearer sp_..." başlığıyla.
 */

var cc = DataStudioApp.createCommunityConnector();
var DEFAULT_URL = "https://reblebi.com";

/* ---------------- Kimlik doğrulama: API anahtarı ---------------- */

function getAuthType() {
  return cc.newAuthTypeResponse().setAuthType(cc.AuthType.KEY).setHelpUrl("https://reblebi.com/docs/mcp").build();
}

function setCredentials(request) {
  var key = request.key;
  if (!key || key.indexOf("sp_") !== 0) return { errorCode: "INVALID_CREDENTIALS" };
  PropertiesService.getUserProperties().setProperty("reblebi.key", key);
  return { errorCode: "NONE" };
}

function isAuthValid() {
  var key = PropertiesService.getUserProperties().getProperty("reblebi.key");
  return Boolean(key && key.indexOf("sp_") === 0);
}

function resetAuth() {
  PropertiesService.getUserProperties().deleteProperty("reblebi.key");
}

function isAdminUser() {
  return false;
}

/* ---------------- Yapılandırma ---------------- */

function getConfig() {
  var config = cc.getConfig();
  config.newInfo().setId("info").setText("Reblebi panelindeki kanalların günlük metrikleri (takipçi, gönderi, etkileşim, erişim…). Tarih aralığını rapordan seç.");
  config.newTextInput().setId("baseUrl").setName("Sunucu adresi").setHelpText("Kendi kurulumunsa onun adresi; varsayılan " + DEFAULT_URL).setPlaceholder(DEFAULT_URL).setAllowOverride(true);
  config.setDateRangeRequired(true);
  return config.build();
}

/* ---------------- Şema ---------------- */

function getFields() {
  var fields = cc.getFields();
  var types = cc.FieldType;
  var agg = cc.AggregationType;
  fields.newDimension().setId("date").setName("Tarih").setType(types.YEAR_MONTH_DAY);
  fields.newDimension().setId("network").setName("Ağ").setType(types.TEXT);
  fields.newDimension().setId("channel").setName("Kanal").setType(types.TEXT);
  fields.newDimension().setId("channelId").setName("Kanal kimliği").setType(types.TEXT);
  // Takipçi günlük bir durum değeridir: toplamak yerine en büyük değer (ya da son gün) kullanılmalı
  fields.newMetric().setId("followers").setName("Takipçi").setType(types.NUMBER).setAggregation(agg.MAX);
  [
    ["posts", "Gönderi"],
    ["likes", "Beğeni"],
    ["comments", "Yorum"],
    ["shares", "Paylaşım"],
    ["saves", "Kaydetme"],
    ["interactions", "Etkileşim"],
    ["postViews", "Gönderi görüntülenme"],
    ["reach", "Erişim (günlük)"],
    ["accountViews", "Hesap görüntülenme"],
    ["profileViews", "Profil ziyareti"],
    ["websiteClicks", "Web sitesi tıklaması"],
    ["follows", "Yeni takip"],
    ["unfollows", "Takibi bırakan"],
    ["watchMinutes", "İzlenme süresi (dk)"],
  ].forEach(function (f) {
    fields.newMetric().setId(f[0]).setName(f[1]).setType(types.NUMBER).setAggregation(agg.SUM);
  });
  return fields;
}

function getSchema() {
  return { schema: getFields().build() };
}

/* ---------------- Veri ---------------- */

function fetchRows(baseUrl, from, to) {
  var key = PropertiesService.getUserProperties().getProperty("reblebi.key");
  var url = (baseUrl || DEFAULT_URL).replace(/\/$/, "") + "/api/export/daily?from=" + from + "&to=" + to;
  var res = UrlFetchApp.fetch(url, { headers: { Authorization: "Bearer " + key }, muteHttpExceptions: true });
  if (res.getResponseCode() === 401) {
    cc.newUserError().setText("API anahtarı geçersiz. Bağlayıcı ayarlarından yeniden gir.").throwException();
  }
  if (res.getResponseCode() !== 200) {
    cc.newUserError().setText("Reblebi verisi alınamadı (" + res.getResponseCode() + ").").setDebugText(res.getContentText().slice(0, 500)).throwException();
  }
  return JSON.parse(res.getContentText()).rows;
}

function getData(request) {
  var requested = request.fields.map(function (f) {
    return f.name;
  });
  var schema = getFields().forIds(requested);
  var range = request.dateRange || {};
  var rows = fetchRows(request.configParams && request.configParams.baseUrl, range.startDate, range.endDate);
  var data = rows.map(function (r) {
    return {
      values: requested.map(function (id) {
        var v = r[id];
        if (id === "date") return String(v).replace(/-/g, "");
        return v === null || v === undefined ? (id === "network" || id === "channel" || id === "channelId" ? "" : null) : v;
      }),
    };
  });
  return { schema: schema.build(), rows: data };
}
