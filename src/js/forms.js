// ====================================
// Forms

import $ from 'jquery';
//import _ from 'lodash';
import {lg} from './quick-log';

// ====================================
// Text Fields with Icon on Left or Right
//   For input fields with an icon or text placed inside its right side, 
//   measure the width of the icon or text and add padding to the input field

let $icon_right = $('.icon-right'),					// Field with icon-right class
	$icon_left = $('.icon-left');					// Field with icon-left class

if ($icon_right.length) {
	$icon_right.map(function(v,k){
		let x = $(k).find('.form-icon').outerWidth();
		$(k).find('input').css({'padding-right': x + 3});
	});
}

// ====================================
// Select Fields
//   Adjust the width of the select object so it does not cover the custom drop-down arrow icon

let $select_input = $('.select-input');				// Select input div that contains select input objects

if ($select_input.length) {
	$select_input.map(function(v,k){
		let x = $(k).find('.form-icon').outerWidth();
		$(k).find('select').css({'padding-right': x + 3});
	});
}

// ====================================
// Textarea
//   Update character count restriction or recommendation

let $textarea = $('textarea');						// Textarea

if ($textarea.length) {
	$textarea.map(function(v,k){
		// Add event listener only if textarea contains a data-character-limit attribute
		if ($(k).attr('data-character-limit')) {
			$(k).on('change keyup paste', function(){
				let y = $(this).val().length;
				let z = $(k).attr('data-character-limit');
			
				// Update character count display and set class to bad if over the limit
				$(`*[data-textarea-id='${$(this).attr('id')}'] span`)
					.html(z-y)
					.addClass(z > y ? 'good' : 'bad')
					.removeClass(z > y ? 'bad' : 'good');
			});
		}
	});
}

// ====================================
// Upload
//   Custom upload button triggers actual file input object

let $upload_input = $('.upload-input'),				// Upload input field
	$upload_input_button = $('.upload-input-button');	// The custom upload button

if ($upload_input.length) {
	// On click of custom button, trigger actual input field
	$upload_input_button.on('click', function(){
		let x = $(this).attr('data-file-input');
		$(`#${x}`).trigger('click');
	});

	// On chnage of file input field, update text display with name of selected file
	$upload_input.on('change', function(){
		let x = $(this).val();
		let y = x.substring(x.lastIndexOf('\\')+1);
	
		$(`*[data-file-input='${$(this).attr('id')}'] span`)
			.html(`<i class="font_icon font_icon-sm icon-document legalzoom-blue"></i>${y}`)
			.removeClass('nofile');
	});
}


													lg(`forms {blue{loaded}}`);