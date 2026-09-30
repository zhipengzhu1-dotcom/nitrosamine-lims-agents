/* boot.js: every load is a deep link. */
App.deepLink(location.hash.slice(1) || 'queue');
