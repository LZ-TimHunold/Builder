// ====================================
// Modal

import $ from 'jquery';
import _ from 'lodash';
import {lg} from './quick-log';

let $tab_content = $('.tab-content'),				// The modals to open/hide
	$tab_link = $('.tab-link');						// What gets clicked to open the modal

if ($tab_content.length) {
	// Show tab
	function show_tab($tab){
		$tab.siblings('.tab-content').removeClass('active');
		$tab.addClass('active');
	}

	$tab_link.on('click', function(){
		$(this).siblings('.tab-link').removeClass('active');
		$(this).addClass('active');
	
		let x = $(this).attr('data-tab');
		show_tab($(`.${x}`));
	});
}

													lg(`tab {blue{loaded}}`);