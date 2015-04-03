// ====================================
// Form Buttons

import $ from 'jquery';
import _ from 'lodash';
import {lg} from './quick-log';
import {isDesktop} from './check-breakpoint';

let $form_buttons = $('.form-buttons').not('.force-height');				// List containing radio or checkbox controls to be converted to buttons

if ($form_buttons.length) {
	
	// ------------------------------------
	// Check height of tallest button in each button group.
	// Make all buttons in that group same height.
	function conform_button_heights(){
		if (isDesktop()) {
			$form_buttons.map(function(v,k){
				let $num_buttons = $(k).find('label');
				let tallest_height = 0;
				$num_buttons.map(function(a,b){
					let this_height = $(b).outerHeight();
					tallest_height = this_height > tallest_height ? this_height : tallest_height;
				});
				$num_buttons.css({'height': tallest_height});
			});
		} else {
			$form_buttons.map(function(v,k){
				let $num_buttons = $(k).find('label');
				$num_buttons.css({'height': 'auto'});
			});
		}
	}
	
	conform_button_heights();
	
	let debounce_conform_button_heights = _.debounce(conform_button_heights, 100);
	
	// Resize button heights on window resize
	$(window).on('resize', function() {
		debounce_conform_button_heights();
	});

}

													lg(`form buttons {blue{loaded}}`);