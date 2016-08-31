(function () {
  'use strict';

  var config,
      session;


  /**
   * Provides the current session if the access token is valid.
   * Otherwise, starts the authorization process to retrieve a new access token.
   */
  function checkAccessToken() {
      return new Promise(function (resolve, reject) {
          if (session.access_token) {
              resolve(session);
          } else {
              getAccessToken().then(resolve).catch(reject);
          }
      });
  }


  /**
   * Starts the authorization flow and retrieves an access token upon success.
   */
  function getAccessToken() {
      return new Promise(function (resolve, reject) {
          var url;

          url = config.AUTH_SERVICE_BASE_URI + 'authorization' +
                '?client_id=' + config.SKY_API_APP_ID +
                '&response_type=token' +
                '&redirect_uri=' + chrome.identity.getRedirectURL('oauth2');

          // Starts an authorization flow at the specified URL.
          // - https://developer.chrome.com/apps/identity#method-launchWebAuthFlow
          chrome.identity.launchWebAuthFlow(
              {
                  'url': url,
                  'interactive': true
              },

              // Retrieves the value of the `code` URL parameter and exchanges it for
              // an access token.
              function handleRedirect(responseUrl) {

                  // Handle any errors encountered.
                  if (chrome.runtime.lastError) {
                      console.log(chrome.runtime.lastError.message + ' Possible solutions: \n1) Is your SKY API Application redirect URI set to ' + chrome.identity.getRedirectURL('oauth2') + '? \n2) Is your authorization microservice running? \n3) Did you start the authorization microservice in "Development" mode (type, `export ASPNETCORE_ENVIRONMENT=Development && dotnet run`)?');
                      return reject({
                          error: chrome.runtime.lastError.message + ' Check the Background Page console for more info.'
                      });
                  }

                  // Parse the URL attributes and save it to the session
                  session = getUrlParams('?' + responseUrl.split('#')[1]);
                  resolve(session);
              }
          );
      });
  }


  /**
   * Makes a request to SKY API Constituent Search endpoint:
   *  - https://developer.sky.blackbaud.com/docs/services/56b76470069a0509c8f1c5b3/operations/56b76471069a050520297727
   * The search text parameter's value is set to an email address.
   */
  function getConstituentByEmailAddress(emailAddress) {
      return new Promise(function (resolve, reject) {
          http('GET',
              'https://api.sky.blackbaud.com/constituent/v1/constituents/search',
              {
                  'searchText': emailAddress
              },
              {
                  'bb-api-subscription-key': config.SKY_API_SUBSCRIPTION_KEY,
                  'Authorization': 'Bearer ' + session.access_token
              }
          ).then(resolve).catch(reject);
      });
  }


  /**
   * Parses URL attributes into a usable object.
   */
  function getUrlParams(str) {
      var params;
      params = {};
      if (!str) {
          return params;
      }
      str.replace(/[?&]+([^=&]+)=([^&]*)/gi, function (str, key, value) {
          params[key] = value;
      });
      return params;
  }


  /**
   * Makes HTTP requests.
   */
  function http(method, url, data, headers) {
      return $.ajax({
          method: method || 'GET',
          url: url,
          data: data,
          headers: headers
      });
  }


  /**
   * Receives (and returns) messages from the content.js script.
   */
  function messageHandler(request, sender, callback) {
    var emailAddress,
        parseError;

    parseError = function (reason) {
      if (typeof reason === "string") {
        return callback({
          error: reason
        });
      }
      return callback({
        error: reason.error || reason.responseJSON.message || JSON.parse(reason.responseText)
      });
    };

    switch (request.type) {

    // Make a request to the constituent search API.
    // Ideally, these endpoints would live in a microservice of their own.
    case 'apiSearch':
      emailAddress = request.message.emailAddress;
      checkAccessToken().then(function () {
        getConstituentByEmailAddress(emailAddress).then(function (data) {

          // The token has expired. Attempt to refresh.
          if (data.statusCode === 401) {
            getAccessToken().then(function () {
              getConstituentByEmailAddress(emailAddress).then(callback).catch(parseError);
            }).catch(parseError);
          }

          // All is well, return the constituent data.
          else {
            callback(data);
          }
        }).catch(parseError);
      }).catch(parseError);
      break;

    // Get configuration YAML file.
    case 'getConfig':
      http('GET',
        chrome.runtime.getURL('config.yml')
      ).then(function (data) {
        config = YAML.parse(data);
        callback(config);
      });
      break;

    // Get the HTML file used to build the detail flyup.
    case 'getConstituentDetailTemplate':
      http('GET',
        chrome.runtime.getURL('src/templates/constituent-detail.html')
      ).then(callback);
      break;

    // Unrecognized message type.
    default:
      callback({
          error: 'Invalid message type.'
      });
      break;
    }

    // Indicate that we wish to send a response message asynchronously.
    // http://developer.chrome.com/extensions/runtime.html#event-onMessage
    return true;
  }


  // Stores the response from the authorization microservice.
  session = {};


  // Allow content.js to communicate with this script.
  chrome.runtime.onMessage.addListener(messageHandler);
}());
