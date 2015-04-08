// ====================================
// Form Buttons

import $ from 'jquery';
import _ from 'lodash';
import {lg} from './quick-log';
import {isDesktop} from './check-breakpoint';

// ====================================
// Form Style 1

let $form_style_1 = $('.form-style-1');

if ($form_style_1.length) {
	function form_style_1_update(){
		
		if (isDesktop()) {							// On Desktop, style elements
			$form_style_1.map(function(v,k){
				let container_width = $(k).outerWidth(),
					label_width = $(k).find('label').outerWidth(),
					label_margin = Number($(k).find('label').css('margin-right').replace('px', ''));
				
				let $input_container = $(k).find('.input-container'),	// Input Container
					$input = $(k).find('input'),						// Input Field
					$input_underline = $(k).find('.input-underline');	// Dynamic underline
				
				$input_container
				.css({								// Set input container width to remaining width
					'width': container_width - label_width - label_margin - 1
				});
				
				$input_underline
				.css({'width': get_input_width($input)})	// Set initial width of underline to match placeholder
				.on('click', function(){			// On click, set focus on input field. For some reason, I applying any type of position attribute to the input field broke the ability to update the underline width.
					$input.focus();
				});
				
				$input
				.on('change keyup paste', function(){	// Update width of underline as user types
					let x = get_input_width($input);
					$input_underline.css({'width': x});
				})
				
			});
		} else {									// On Mobile, revert to default
			$form_style_1.map(function(v,k){
				$(k).find('.input-container').css({
					'width': '100%'
				});
			});
		}
	}
	
	let debounce_form_style_1_update = _.debounce(form_style_1_update, 50);	// Debounce to throttle during window resize
	debounce_form_style_1_update();
	
	$(window).on('resize', function() {				// Re-render on window resize
		debounce_form_style_1_update();
	});
}

// ====================================
// Helper Functions for Custom Styles

function get_input_width($this) {
	let x1 = $this.css('font'),						// Get necessary attributes to recreate object with same width
		x2 = $this.css('padding'),
		x3 = $this.css('border-left'),
		x4 = $this.css('border-right'),
		x5 = $this.val(),
		x6 = $this.attr('placeholder');
	$('body').append(`<span class="tmp" style="font:${x1};padding:${x2};border-left:${x3};border-right:${x4};background:orange;width:auto;position:absolute;opacity:0;height:0;">${x5 ? x5 : x6}</span>`);	// Create temp object
	let this_width = $('.tmp').outerWidth();		// Measure temp object
	$('.tmp').remove();								// Delete temp object
	return this_width;								// Return the width
}

													lg(`form custom {blue{loaded}}`);