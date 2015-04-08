// ====================================
// Modal

import $ from 'jquery';
import _ from 'lodash';
import {lg} from './quick-log';

let $modal = $('.modal'),							// The modals to open/hide
	$modal_link = $('.modal-link'),					// What gets clicked to open the modal
	$modal_margin = $('.modal-margin');				// Margin surrounding modal that can be clicked to close

if ($modal.length) {
	// Show modal 
	function show_modal($modal, scrollY) {
		let window_width = $(window).width(),		// Viewport width
			window_height = $(window).height();		// Viewport height
	
		// Show modal but hide with opacity, because we need to check if modal content is taller than viewport to make quick adjustments before making it fully visible.
		$modal.css({'opacity': 0, 'height': window_height}).show();
	
		let $article = $modal.find('article');		// The modal content area.
		let close_btn_margin = 40;					// Extra margin to accommodate the Close button that sits outside modal content area.

		// If modal content is taller than viewport height
		if ($article.outerHeight() + (close_btn_margin * 2) > window_height) {
			$modal.find('.modal-inner-margin').removeClass('centerV');
			$modal.find('.modal-margin').css({'height': $article.outerHeight() + close_btn_margin * 2});
			$modal.css({'overflow': 'scroll'});
			$article.css({'top': close_btn_margin});
		// If modal content is shorter than viewport height
		} else {
			$modal.find('.modal-inner-margin').addClass('centerV');
			$modal.find('.modal-margin').css({'height': '100%'});
			$modal.css({'overflow': 'visible'});
			$article.css({'top': 0});
			$modal.css({'height': window_height});
		}
	
		// Now show the modal
		$modal.css({'opacity': 1});
	
		// Prevent scrolling of content beneath modal
		$('body').css({'overflow': 'hidden'});
		
		// Check if modal contains video. If so, autoplay video.
		// We can assume there will only be one video.
		// There should not be any modals that contain multiple videos or videos with extensive text.
		let $video = $modal.find('.video');
		if ($video.length) {
			// All we need to do is trigger the click event on the play button.
			$video.find('.video-controls').find('.play').trigger('click');
		}
	}

	// Close modal 
	function close_all_modals() {
		$modal.map(function(v,k){
			if ($(k).css('display') === 'block') {
				$(k).scrollTop(0).hide().css({'height': $(window).height()});
														//let lg_1 = $(k).attr(`class`).replace(`modal `, ``);
														//lg(`modal {blue{hidden}}: {purple{${lg_1 }}}`);
			}
		});
	
		// Reset body overflow to visible
		$('body').css({'overflow': 'visible'});
		
		// Check if modal contains video. If so, then stop playback and reset playhead to the beginning.
		let $video = $modal.find('.video');
		if ($video.length) {
			let $id = $video.find('video').attr('id');
			let $v = document.getElementById($id);
			$v.pause();
			$v.currentTime = 0;
		}
	}

	// Close modal debounce
	let debounce_close_all_modals = _.debounce(close_all_modals, 200);

	// Open modal on click
	$modal_link.on('click', function(e){
		e.preventDefault();
		let x = $(this).attr('data-modal');
		let y = $(window).scrollTop();
		show_modal($(`.${x}`),y);
														lg(`modal {blue{shown}}: {purple{${x}}}`);
	});

	// Close modal on click
	$modal_margin.on('click', function(e){
		if( ($(e.target).is($modal_margin)) || ($(e.target).is('.modal-inner-margin')) || ($(e.target).is('.modal-close')) || ($(e.target).is('.icon-x')) ){ // Make sure it's only the area surrounding the modal that is clicked.
			close_all_modals();
		}
	});

	// Close modal on keyup of "escape" key
	$(document).keyup(function(e){
		switch(e.keyCode) {
			case 27: // escape
				close_all_modals();
				break;
		}
		return;
	});

	// Clean up modals on resize by just hiding all of them. Debounce to throttle.
	$(window).on('resize', function() {
		debounce_close_all_modals();
	});
}

													lg(`modal {blue{loaded}}`);