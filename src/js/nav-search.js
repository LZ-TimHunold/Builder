// ====================================
// Navigation Search

import $ from 'jquery';
import _ from 'lodash';
import {lg} from './quick-log';

let $input = $('.nav-search input'),				// Search input field in header
	$button = $('.nav-search button'),				// Search button
	$results = $('.nav_search_results');			// Mini results (that display auto-suggestions as user types)

if ($input.length) {

	let placeholder_text = $input.attr('placeholder');	// Store the placeholder text

	// Debounce functions to tweak interaction timing
	let debounce_show_results = _.debounce(show_results, 240),
		debounce_hide_results = _.debounce(hide_results, 400);

	// Show results menu
	function show_results() {
		position_results();
		$results.show();
	}

	// Hide results menu
	function hide_results() {
		$results.hide();
	}

	// Position results menu
	function position_results() {
		let x = $input.offset().left,
			y = $input.offset().top,
			h = $input.height();

		$results.css({
			top: y + h,
			left: x
		});
	}

	// Input focus and blur
	$input
	.on('focus', function(){

		// Changes to input field and button appearance
		$(this).attr({'placeholder': ''});
		$button.toggleClass('active');

		// Change results position
		position_results();
	})
	.on('blur', function(){

		// Changes to input field and button appearance
		$(this)
		.attr({'placeholder': placeholder_text})
		.val('');
		$button.toggleClass('active');
	
		hide_results();
	})
	.on('keypress', function(){
		debounce_show_results();
	})
	.on('click', function(){
		if ($(this).val() > '') {						// Accommodates scenario: User enters text. Menu displays. User mouses over and out of menu without blurring focus of input. Menu hides. User clicks back on input field. Menu shows if the input field contains a value.
			show_results();
		}
	})
	.on('mouseleave', function(){
		debounce_show_results.cancel();
		debounce_hide_results();
	});

	// Results mouseenter and mouseleave
	$results
	.on('mouseenter', function(){
		debounce_hide_results.cancel();
	})
	.on('mouseleave', function(){
		debounce_show_results.cancel();
		debounce_hide_results();
	});

	// Clean up on window resize
	$(window).on('resize', function() {
		debounce_hide_results();
	});
}

													lg(`nav_search {blue{loaded}}`);
