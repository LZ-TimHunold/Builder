// ====================================
// Map
// Using Google Map JavaScript API

var mapsapi = require('google-maps-api')('AIzaSyCGWW2JRZEhQoygvFrOntDpQjftGKaaudQ');
var $ = require('jquery');
var _ = require('lodash');
var lg = require('./quick-log');

if ($('#map-canvas').length) {
	mapsapi().then( function( maps ) {

		function initialize() {
	
			var myLatlng = new google.maps.LatLng(34.1468759,-118.2554708);
		
			var mapOptions = {
				zoom: 14,
				center: myLatlng
			};
			var map = new google.maps.Map(
				document.getElementById('map-canvas'),
				mapOptions
			);
														lg.lg('# {purple{maps api}} {orange{loaded}}');

			map.setOptions({
				'scrollwheel': false
			});
		
			var marker = new google.maps.Marker({
				position: myLatlng,
				map: map
				//title:"Hello World!"
			});
			marker.setMap(map);
		
		}

		//google.maps.event.addDomListener(window, 'load', initialize);
		initialize();

	});
}

													lg.lg('map {blue{loaded}}');