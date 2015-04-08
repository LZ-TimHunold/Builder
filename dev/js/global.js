var $ = require('jquery');
var _ = require('lodash');
var lg = require('./quick-log');

// The following script is unavailable to install as a package, so I've just pasted the entirety of it here.
// Chose this script because of its light footprint and it does this one basic thing.
// I've further pared it down with unnecessary options and made a few additional changes.

 /*
 * AutoSuggest
 * Copyright 2009-2010 Drew Wilson
 * www.drewwilson.com
 * code.drewwilson.com/entry/autosuggest-jquery-plugin
 *
 * Forked by Wu Yuntao
 * github.com/wuyuntao/jquery-autosuggest
 *
 * Version 1.6.2
 *
 * This Plug-In will auto-complete or auto-suggest completed search queries
 * for you as you type. You can add multiple selections and remove them on
 * the fly. It supports keybord navigation (UP + DOWN + RETURN), as well
 * as multiple AutoSuggest fields on the same page.
 *
 * Inspired by the Autocomplete plugin by: Joern Zaefferer
 * and the Facelist plugin by: Ian Tearle (iantearle.com)
 *
 * This AutoSuggest jQuery plug-in is dual licensed under the MIT and GPL licenses:
 *	 http://www.opensource.org/licenses/mit-license.php
 *	 http://www.gnu.org/licenses/gpl.html
 */

var $form_autocomplete = $('.form-autocomplete');	// Inputs with form-autocomplete class

if ($form_autocomplete.length) {
	(function($) {
		$.fn.autoSuggest = function(data, options) {
			var defaults = {
				selectedItemProp: 'value', //name of object property
				selectedValuesProp: 'value', //name of object property
				searchObjProps: 'value', //comma separated list of object property names
				minChars: 1,
				keyDelay: 100,
				resultsHighlight: true,
				showResultList: true,
				canGenerateNewSelections: true,
				start: function() {},
				selectionClick: function(elem) {},
				selectionAdded: function(elem) {},
				selectionRemoved: function(elem) { elem.remove(); },
				resultClick: function(data) {},
				resultsComplete: function() {},
				keychange_one_time_kill: false
			};
			var opts = $.extend(defaults, options);

			function countValidItems(data) { var n = 0; for (k in data) if (data.hasOwnProperty(k)) n++; return n; }

			var d_fetcher = function(query, next) { next(data, query); };

			if (d_fetcher) {
				return this.each(function(x) {
					if (!opts.asHtmlID) {
						x = x+''+Math.floor(Math.random()*100); //this ensures there will be unique IDs on the page if autoSuggest() is called multiple times
						var x_id = 'as-input-'+x;
					} else {
						x = opts.asHtmlID;
						var x_id = x;
					}
					opts.start.call(this, {
						add: function(data) {
								 add_selected_item(data, 'u' + $('li', selections_holder).length).addClass('blur');
							 },
						remove: function(value) {
									values_input.val(values_input.val().replace(','+value+',',','));
									selections_holder.find('li[data-value = "' + value + '"]').remove();
								}
					});
					var input = $(this);
					input.attr('autocomplete','off').addClass('as-input').attr('id',x_id);
					var input_focus = false;

					// Setup basic elements and render them to the DOM
					input.wrap('<ul class="as-selections" id="as-selections-'+x+'" style="background:orange;"></ul>').wrap('<li class="as-original" id="as-original-'+x+'"></li>');
					var selections_holder = $('#as-selections-'+x);
					var org_li = $('#as-original-'+x);
					var results_holder = $('<div class="as-results" id="as-results-'+x+'"></div>').hide();
					var results_ul =	$('<ul class="as-list"></ul>');
					var values_input = $('<input type="hidden" class="as-values" name="as_values_'+x+'" id="as-values-'+x+'" />');
					input.after(values_input);
					selections_holder.click(function() {
						input_focus = true;
						input.focus();
					}).mousedown(function() { input_focus = false; }).after(results_holder);

					var prev = '';
					var totalSelections = 0;
					var tab_press = false;
					var lastKeyPressCode = null;

					// Handle input field events
					input.focus(function() {
						if (input_focus) {
							$('li.as-selection-item', selections_holder).removeClass('blur');
						}
						input_focus = true;
						return true;
					}).on('change keyup paste', function() {
						keyChange();
					}).blur(function() {
						if (input_focus) {
							$('li.as-selection-item', selections_holder).addClass('blur').removeClass('selected');
							results_holder.hide();
							input.removeClass('showing-results');
						}
					}).keydown(function(e) {
						// track last key pressed
						lastKeyPressCode = e.keyCode;
						first_focus = false;
						switch(e.keyCode) {
							case 38: // up
								e.preventDefault();
								moveSelection('up');
								break;
							case 40: // down
								e.preventDefault();
								moveSelection('down');
								break;
							case 8:	// delete
								if (input.val() == '') {
									var last = values_input.val().split(',');
									last = last[last.length - 2];
									selections_holder.children().not(org_li.prev()).removeClass('selected');
									if (org_li.prev().hasClass('selected')) {
										values_input.val(values_input.val().replace(','+last+',',','));
										opts.selectionRemoved.call(this, org_li.prev());
									} else {
										opts.selectionClick.call(this, org_li.prev());
										org_li.prev().addClass('selected');
									}
								}
								if (input.val().length == 1) {
									results_holder.hide();
									input.removeClass('showing-results');
									prev = '';
								}
								break;
							case 13: // return
								tab_press = false;
								var active = $('li.active:first', results_holder);
								if (active.length > 0) {
									active.click();
									results_holder.hide();
									input.removeClass('showing-results');
								}
								e.preventDefault();
								break;
						}
					});

					function keyChange() {
						// Check the one time keychange kill
						if (opts.keychange_one_time_kill) {
							opts.keychange_one_time_kill = false;
						} else {
				
				
							// Since most IME does not trigger any key events, if we press [del]
							// and type some chinese character, `lastKeyPressCode` will still be [del].
							// This might cause problem so we move the line to key events section;
							// ignore if the following keys are pressed: [del] [shift] [capslock]
							// if ( lastKeyPressCode == 46 || (lastKeyPressCode > 8 && lastKeyPressCode < 32) ) { return results_holder.hide(); }
							var string = input.val().replace(/[\\]+|[\/]+/g,'');
							if (string == prev) return;
							prev = string;
							// Allow minimum # of characters to be set per control in the HTML.
							// Sizes of results will vary, so that judgment should be made per control rather than as 
							// a global static variable
							if (string.length >= Number(input.attr('data-min-chars'))) {
							//if (string.length >= opts.minChars) {
								//selections_holder.addClass('loading');
								results_holder.hide();
								input.removeClass('showing-results');
								processRequest(string);
							} else {
								//selections_holder.removeClass('loading');
								results_holder.hide();
								input.removeClass('showing-results');
							}
						}
					}
					function processRequest(string) {
						d_fetcher(string, processData);
					}
					var num_count = 0;
					function processData(data, query) {
						query = query.toLowerCase();//if (!opts.matchCase) { query = query.toLowerCase(); }
						query = query.replace('(', '\\(', 'g').replace(')', '\\)', 'g');
						var matchCount = 0;
						results_holder.html(results_ul.html('')).hide();
						var d_count = countValidItems(data);
						var forward_kill = false;
						for(var i=0;i<d_count;i++) {
							var num = i;
							num_count++;
							var forward = false;
							if (opts.searchObjProps == 'value') {
								var str = data[num].value;
							} else {
								var str = '';
								var names = opts.searchObjProps.split(',');
								for(var y=0;y<names.length;y++) {
									var name = $.trim(names[y]);
									str = str+data[num][name]+' ';
								}
							}
							if (str) {
								str = str.toLowerCase();//if (!opts.matchCase) { str = str.toLowerCase(); }
								// If query equals display, then there's no need to show the results
								var this_data = $.extend({},data[num]);
								var eee = this_data[opts.selectedItemProp];
								if (query.toLowerCase() === eee.toLowerCase()) {
									forward_kill = true;
								}

								// Split tags separated by commas. Check only if query matches from the beginning (for example, we should not return "Hawaii" if the user typed "wa", because it's clear there's no intention to complete to "Hawaii")
								// Also split query by spaces to check if any terms match
								// Also restrict each split query to the mininum characters set in the HTML input's data attribute
								var str_array = str.split(',');
								var query_array = query.split(' ');
								var minChars = input.attr('data-min-chars');
								query_array.map(function(a,b){
									str_array.map(function(v,k){
										if (query_array[b].length >= minChars) {
											if (str_array[k].trim().search(query_array[b]) === 0) {
												forward = true;
												if (b === 0 && k === 0) {
													forward_kill = false;
												}
											}
										}
									});
								});
							}
							if (forward) {
								var formatted = $('<li class="as-result-item" id="as-result-item-'+num+'"></li>').click(function() {
										var raw_data = $(this).data('data');
										var number = raw_data.num;
										if ($('#as-selection-'+number, selections_holder).length <= 0 && !tab_press) {
											var data = raw_data.attributes;
											input.val('').focus();
											prev = '';
											add_selected_item(data, number);
											opts.resultClick.call(this, raw_data);
											results_holder.hide();
											input.removeClass('showing-results');
										}
										tab_press = false;
									}).mousedown(function() { input_focus = false; }).mouseover(function() {
										$('li', results_ul).removeClass('active');
										$(this).addClass('active');
									}).data('data',{attributes: data[num], num: num_count});
								var this_data = $.extend({},data[num]);
								formatted = formatted.html(this_data[opts.selectedItemProp]);
								results_ul.append(formatted);
								delete this_data;
								matchCount++;
							}
						}
						// Kill showing results if we determined that the query exactly matches a specific result
						if (forward_kill) {
							matchCount = 0;
						}
						if (matchCount > 0) { //if (matchCount > 0 || !opts.showResultListWhenNoMatch) {
							results_holder.show();
							setInitialSelection();//xxx
							input.addClass('showing-results');
						}
						opts.resultsComplete.call(this);
					}

					function add_selected_item(data, num) {
						// Insert selected result into input field
						// Also check data attribute to determine if should convert selection to lowercase.
						// This would be approrpriate if we are inserting this control in the context of a sentence.

						// Set keychange_one_time_kill to true
						opts.keychange_one_time_kill = true;

						if (input.attr('data-selection-lowercase') === 'no') {
							input.val(data.display);
						} else {
							input.val(data.display.toLowerCase());
						}
						return org_li.prev();
					}

					function moveSelection(direction) {
						if ($(':visible',results_holder).length > 0) {
							var lis = $('li', results_holder);
							if (direction == 'down') {
								var start = lis.eq(0);
							} else {
								var start = lis.filter(':last');
							}
							var active = $('li.active:first', results_holder);
							if (active.length > 0) {
								if (direction == 'down') {
								start = active.next();
								} else {
									start = active.prev();
								}
							}
							lis.removeClass('active');
							start.addClass('active');
						}
					}

					function setInitialSelection() {
						if ($(':visible',results_holder).length > 0) {
							var lis = $('li', results_holder);
							lis.removeClass('active');
							lis.eq(0).addClass('active');
						}
					}
				});
			}
		};
	})(jQuery);

	$form_autocomplete.map(function(v,k) {
		// Get to the data embedded on the page
		var thisID = $(k).attr('id'),
			varStr = 'data_' + thisID.replace(/-/g, '_');
			data = window[varStr];

		// Apply autosuggest script to it
		$(k).autoSuggest(data, {selectedItemProp: 'display', searchObjProps: 'tags'});
	});
}

													lg.lg('autosuggest {blue{loaded}}');
// ====================================
// Carousel
// Using http://kenwheeler.github.io/slick/

import $ from 'jquery';
import slick from 'slick-carousel';
import {lg} from './quick-log';

let $slider = $('.slider');							// Sliders

if ($slider.length) {
	$slider
	.map(function(v,k){
		let dots = $(this).attr('data-slider-bullets') === 'no' ? false : true,
			arrows = $(this).attr('data-slider-arrows') === 'no' ? false : true,
			fade = $(this).attr('data-slider-fade') === 'no' ? false : true,
			slidesToShow = parseInt($(this).attr('data-slider-slidesToShow')),
			slidesToScroll = parseInt($(this).attr('data-slider-slidesToScroll')),
			autoplay = $(this).attr('data-slider-autoplay') === 'no' ? false : true,
			autoplaySpeed = parseInt($(this).attr('data-slider-autoplaySpeed')),
			pauseOnHover = $(this).attr('data-slider-pauseOnHover') === 'no' ? false : true;
	
		$(this).slick({
			dots: dots,
			infinite: true,
			speed: 500,
			slidesToShow: slidesToShow,
			slidesToScroll: slidesToScroll,
			arrows: arrows,
			fade: fade,
			autoplay: autoplay,
			autoplaySpeed: autoplaySpeed,
			pauseOnHover: pauseOnHover,
			responsive: [
				{
					breakpoint: 640,
					settings: {
						slidesToShow: 1					// At less than 640px, force only showing 1 slide at a time.
					}
				}
			]
		});
		adjust_slider_height();
	})

	// Clean up slider height
	// For an unknown reason, when slick.js pulls content into the carousel, it retains the "space" where the original content was of the height and width of that content.
	// This was fixed by specifying a height on the slider element (style="height"450px;), which is not ideal, but the only way I discovered that could fix this issue.
	// But setting a height on the slider created a new issue, that the height of content elements (such as class height450) is variable between mobile and desktop, and specifying a height directly on the elements causes it to be the same height on desktop and mobile.
	// So final solution is to check window resize and adjust the height with JavaScript.
	// None of this is ideal, of course, but after many many tests, this is the only solution I've found.
	function adjust_slider_height(){
		let height_adjustment = 0;
		$slider.find('section').map(function(v,k){
			height_adjustment = $(k).outerHeight() > height_adjustment ? $(k).outerHeight() : height_adjustment;
		});
														//lg(`height_adjustment: ${height_adjustment}`);
		$slider.css({'height': height_adjustment});
	}

	$(window).on('resize', function() {
		adjust_slider_height();
	});
}

													lg(`carousel {blue{loaded}}`);
// ====================================
// Check Breakpoint

import $ from 'jquery';
import {lg} from './quick-log';

function isDesktop(){
	if ($(window).width() > 640) {
		return true;
	} else {
		return false;
	}
}
function isMobile(){
	if ($(window).width() <= 640) {
		return true;
	} else {
		return false;
	}
}
function isTablet(){
	if ($(window).width() <= 980) {
		return true;
	} else {
		return false;
	}
}

export {isDesktop, isTablet, isMobile}

													lg(`check breakpoint {blue{loaded}}`);

// ====================================
// Date Picker

import $ from 'jquery';
import _ from 'lodash';
import {lg} from './quick-log';

var	$datepicker = $('.datepicker'),					// Date Picker Container
	$datepicker_month = $('.datepicker > header > h1'),	// Month text
	$button_previous = $('.datepicker > header > .button-previous'), // Previous Month Button
	$button_next = $('.datepicker > header > .button-next'), // Next Month Button
	$days_containers = $('.day-container'),			// Parent container of day cells
	$days = $('.days'),								// Actual container for day cells
	$day_border = $('.day-border.active'),			// Border for selected day
	$readonly_field = $('.datepicker-readonly-field');	// Read-only field that stores selected date for form submission

if ($datepicker.length) {
	var datepicker = {
		// ====================================
		// Initialize
		init: function(){
			var inputDateString = $readonly_field.val(),
				inputDateParse = inputDateString.split('/'),
				inputDate = new Date(inputDateParse[2], inputDateParse[0] - 1, inputDateParse[1]),
				isDateValid = inputDate.getTime() === inputDate.getTime();
			if (isDateValid) {
				this.date.current = inputDate;
				this.date.selected = inputDate;
			} else {
				this.date.current = new Date();
				this.date.selected = null;
			}
			this.date.today = new Date();
			this.buildDisplay();
		},
		// ====================================
		// Data
		date: {
			today: null, // today's date
			current: null, // current date is used for which month is displayed
			selected: null // date selected by user
		},
		months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
		holidays: [
			{month: 0,	day: 1,		name: 'New Year\'s Day'},
			{month: 0,	day: 20,	name: 'Martin Luther King\'s Birthday'},
			{month: 1,	day: 17,	name: 'George Washington\'s Birthday'},
			{month: 4,	day: 26,	name: 'Memorial Day'},
			{month: 5,	day: 4,		name: 'Independence Day'},
			{month: 8,	day: 1,		name: 'Labor Day'},
			{month: 9,	day: 13,	name: 'Columbus Day'},
			{month: 10,	day: 11,	name: 'Veterans Day'},
			{month: 10,	day: 27,	name: 'Thanksgiving Day'},
			{month: 11,	day: 25,	name: 'Christmas Day'}
		],
		options: {
			allow_weekends: $datepicker.attr('data-allow-weekends'),
			allow_holidays: $datepicker.attr('data-allow-holidays')
		},
		// ====================================
		// Render the Days of Currently-Viewed Month
		buildDisplay: function(){
			// ------------------------------------
			// Check if selected date already exists from input form and set up so day can be hilited
			var selectedDay = 0;
			if(this.date.selected){
				var selectedMonth = this.date.selected.getUTCMonth(),
					currentMonth = this.date.current.getUTCMonth(),
					currentYear = this.date.current.getUTCFullYear(),
					todaysYear = this.date.today.getUTCFullYear(),
					holidaysThisMonth = _.filter(this.holidays, {'month': currentMonth}),
					isHoliday = 0;
				if(selectedMonth === currentMonth && !isHoliday){
					selectedDay = this.date.selected.getUTCDate();
				}
				// Check if day is holiday. This is if user manually typed a date that is a holiday
				holidaysThisMonth.map(function(v,k){
					if(selectedDay === v.day){
						isHoliday = 1;
						selectedDay = 0;
					}
				});
				// ------------------------------------
				// Check if year is in current year. This is if user manually entered a year that is not the current year.
				if(currentYear !== todaysYear || isHoliday){
					$readonly_field.val('');
					datepicker.date.selected = null;
				}
			}
		
			// ------------------------------------
			// Construct month day cells
			var monthFirstDay = new Date(datepicker.date.current.getUTCFullYear(), datepicker.date.current.getUTCMonth(), 1),
				monthLastDay = new Date(datepicker.date.current.getUTCFullYear(), datepicker.date.current.getUTCMonth() + 1, 0),
				daysInMonth = monthLastDay.getUTCDate(),
				emptyCellsFront = monthFirstDay.getUTCDay(),
				//emptyCellsEnd = Math.ceil(daysInMonth/7) - emptyCellsFront,
				emptyCellsEnd = 6 - monthLastDay.getUTCDay(),
				currentMonth = monthFirstDay.getUTCMonth(),
				HTMLString = '',
				dayCount = 0,
				holidaysThisMonth = _.filter(this.holidays, {'month': currentMonth}) // Create new object of only holidays of current month since unnecessary to check against all holiday. While not really gaining much, it simplifies that we only need to check against just the day
				;

			// ------------------------------------
			// Set up header
			$datepicker_month.html(datepicker.months[monthFirstDay.getUTCMonth()] + ' ' + datepicker.date.current.getUTCFullYear());
		
			// ------------------------------------
			// Get width of container
			var parentOuterWidth = $datepicker.parent().outerWidth();
		
			// ------------------------------------
			// Add days of week
			
			HTMLString += '' + 
				'<div class="day_of_week"><span class="desktop-tablet-only">Sun<span class="desktop-only">day</span></span><span class="mobile-only">S</span></div>' + 
				'<div class="day_of_week"><span class="desktop-tablet-only">Mon<span class="desktop-only">day</span></span><span class="mobile-only">M</span></div>' + 
				'<div class="day_of_week"><span class="desktop-tablet-only">Tue<span class="desktop-only">sday</span></span><span class="mobile-only">T</span></div>' + 
				'<div class="day_of_week"><span class="desktop-tablet-only">Wed<span class="desktop-only">nesday</span></span><span class="mobile-only">W</span></div>' + 
				'<div class="day_of_week"><span class="desktop-tablet-only">Thu<span class="desktop-only">rsday</span></span><span class="mobile-only">T</span></div>' + 
				'<div class="day_of_week"><span class="desktop-tablet-only">Fri<span class="desktop-only">day</span></span><span class="mobile-only">F</span></div>' + 
				'<div class="day_of_week"><span class="desktop-tablet-only">Sat<span class="desktop-only">urday</span></span><span class="mobile-only">S</span></div>'
		
			// ------------------------------------
			// Add empty cells in front
			for (var i = 0; i < emptyCellsFront; i++){
				dayCount++;
				if (i + 1 < emptyCellsFront) {
					HTMLString += '<div class="day day_empty"><div class="day_number"></div></div>';
				} else {
					HTMLString += '<div class="day day_empty" style="width:' + (parentOuterWidth * .134284) + 'px;margin-right:1%;"><div class="day_number"></div></div>';
				}
			}
			// ------------------------------------
			// Add day cells		
			for (var i = 0; i < daysInMonth; i++){
				dayCount++;
			
				// Check if this is a holiday
				var isHoliday = null,
					holidayName = '';

				holidaysThisMonth.map(function(v,k){
					if(v.day === i+1){
						isHoliday = 1;
						holidayName = v.name;
					}
				});
				
				if(isHoliday){
					if (datepicker.options.allow_holidays === 'no') {
						HTMLString += '<div class="day day_holiday"><div class="day_number">' + (i + 1) + '</div><div class="day_text_bottom">' + holidayName + '</div></div>';
					} else {
						HTMLString += '<div class="day day_active day_holiday"><div class="day_number">' + (i + 1) + '</div><div class="day_text_bottom">' + holidayName + '</div></div>';
					}
				} else {
					if(datepicker.options.allow_weekends === 'no' && (dayCount % 7 === 0 || dayCount % 7 === 1)){
						HTMLString += '<div class="day day_inactive"><div class="day_number">' + (i + 1) + '</div></div>';
					} else {
						
						if (this.date.current.getUTCMonth() === this.date.today.getUTCMonth() && this.date.current.getFullYear() === this.date.today.getFullYear() && this.date.today.getDate() === i + 1) {
							HTMLString += '<div class="day day_active day_today day' + (i + 1) + '"><div class="day_number">' + (i + 1) + '</div><div class="day_text_top">Today</div></div>';
						} else {
							HTMLString += '<div class="day day_active day' + (i + 1) + '"><div class="day_number">' + (i + 1) + '</div></div>';
						}
						//if(selectedDay === (i + 1)){
						//	HTMLString += '<div class="day day_active active"><div class="day_number">' + (i + 1) + '</div></div>';
						//} else {
						//}
					}
				}
			}
			// ------------------------------------
			// Add empty cells at end
			emptyCellsEnd += 42 - (emptyCellsFront + daysInMonth + emptyCellsEnd);
		
			for (var i = emptyCellsEnd; i > 0; i--){
				if ((i - 1) % 7 !== 0) {
					HTMLString += '<div class="day day_empty"><div class="day_number"></div></div>';
				} else {
					HTMLString += '<div class="day day_empty" style="width:' + (parentOuterWidth * .134284) + 'px;"><div class="day_number"></div></div>';
				}
			}
			HTMLString += '<br class="clear">';
			
			// ------------------------------------
			// Clean up
			$day_border.css({'display': 'none'});
			$('.day-border.invalid').remove();
			
			// ------------------------------------
			// Insert HTML to display
			$days.html(HTMLString);
		
			$('.day').map(function(v,k){
				$(k).css({
					'margin-bottom': parentOuterWidth * .01
				});
			});

			// ------------------------------------
			// Add Borders for Invalid Holidays
			var timer = setTimeout(function(){
				$day_holiday = $('.day_holiday');
				$day_holiday.each(function(){
					var $div = $(this);
					$days_containers.prepend('<div class="day-border invalid" style="display:block;left:' + ($div.position().left - 2) + 'px;top:' + ($div.position().top - 2) + 'px;width:' + ((parentOuterWidth * .134284) + 4) + 'px"></div>');
				});
			}, 10);
		
			// ------------------------------------
			// If a date has already been selected, then hilite that day cell
			if(selectedDay){
				datepicker.selectDate($('.day' + selectedDay));
			}
		
			// ------------------------------------
			// Don't allow navigating to past months
			if (this.date.current.getUTCMonth() === this.date.today.getUTCMonth() && this.date.current.getFullYear() === this.date.today.getFullYear()) {
				$button_previous.addClass('inactive');
			} else {
				$button_previous.removeClass('inactive');
			}
		
			// ------------------------------------
			// Bindings
			var $day_active = $('.day_active'),
				$day_holiday = $('.day_holiday');
		
			$day_active
			.on('mouseenter', function(){})
			.on('mouseleave', function(){
				var $div = $(this);
				$div.removeClass('day_style_hover');
			})
			.on('click touchend', function(){
				datepicker.selectDate($(this));
				datepicker.saveSelection();
			});
		
			/*
			$day_holiday.on('mouseenter', function(){
				var $div = $(this),
					thisMonth = datepicker.date.current.getUTCMonth(),
					thisDay = Number($div.find('.day_number').text()),
					holiday = _.filter(datepicker.holidays, {'month': thisMonth, 'day': thisDay}), // Retrieve name of holiday
					htmlContent = '<h1>Holiday</h1><p>' + holiday[0].name + '</p>';
				//tooltip.show($(this), htmlContent);
			}).on('mouseleave', function(){
				//tooltip.hide($(this));
			});
			*/
		},
		// ====================================
		// Select Date
		selectDate: function($div){
			var $day_active = $('.day_active');

			// Position Selection Border and Style cell
			var posX = $div.position().left,
				posY = $div.position().top;
			var parentOuterWidth = $datepicker.parent().outerWidth();
			$day_border.css({'display': 'block', 'left': posX - 2, 'top': posY - 2, 'width': (parentOuterWidth * .134284) + 4});
			$day_active.removeClass('active');
			$div.addClass('active');
		
			// Set Selected Date
			var thisDay = Number($div.find('.day_number').text());
			datepicker.date.selected = new Date(datepicker.date.current.getUTCFullYear(), datepicker.date.current.getUTCMonth(), thisDay);
		
		},
		// ====================================
		// Save Date Data to Read-Only Field
		saveSelection: function(){
			if(datepicker.date.selected){
				var month = datepicker.date.selected.getUTCMonth() + 1,
					day = datepicker.date.selected.getUTCDate(),
					year = datepicker.date.selected.getUTCFullYear();
				$readonly_field.val(month + '/' + day + '/' + year);
			}
		}
	};

	// Initialize Date Picker
	datepicker.init();

	// Button Previous Month
	$button_previous.on('click touchend', function(e){
		e.preventDefault();
		if(!$(this).hasClass('inactive')){
			datepicker.date.current = new Date(datepicker.date.current.getUTCFullYear(), datepicker.date.current.getUTCMonth() - 1, 1);
			datepicker.buildDisplay();
		}
	});

	// Button Next Month
	$button_next.on('click touchend', function(e){
		e.preventDefault();
		if(!$(this).hasClass('inactive')){
			datepicker.date.current = new Date(datepicker.date.current.getUTCFullYear(), datepicker.date.current.getUTCMonth() + 1, 1);
			datepicker.buildDisplay();
		}
	});

	// Window Resize
	$(window).on('resize', function(){
		datepicker.init();
	});
}

													lg(`date picker {blue{loaded}}`);
// ====================================
// Date Picker

import $ from 'jquery';
import _ from 'lodash';
import {lg} from './quick-log';

var	$datepicker = $('.datepicker'),					// Date Picker Container
	$datepicker_month = $('.datepicker > header > h1'),	// Month text
	$button_previous = $('.datepicker > header > .button-previous'), // Previous Month Button
	$button_next = $('.datepicker > header > .button-next'), // Next Month Button
	$days_containers = $('.day-container'),			// Parent container of day cells
	$days = $('.days'),								// Actual container for day cells
	$readonly_field = $('.datepicker-readonly-field');	// Read-only field that stores selected date for form submission

if ($datepicker.length) {
	var datepicker = {
		// ====================================
		// Initialize
		init: function(){
			var inputDateString = $readonly_field.val(),	// $readonly_field.val() can be replaced by a date the user has already selected. For example, in an incomplete questionnaire where the user has already selected a date, insert that date here so the calendar will have that date hilited and selected.
				inputDateParse = inputDateString.split('/'),
				inputDate = new Date(inputDateParse[2], inputDateParse[0] - 1, inputDateParse[1]),
				isDateValid = inputDate.getTime() === inputDate.getTime(); // We probably will not need this, because we should be validating the date already before we store it, but it's here just in case. Can't hurt.
			if (isDateValid) {
				this.date.current = inputDate;
				this.date.selected = inputDate;
			} else {
				this.date.current = new Date();
				this.date.selected = null;
			}
			this.date.today = new Date();
			this.buildDisplay();
		},
		// ====================================
		// Data
		date: {
			today: null, // today's date
			current: null, // current date is used for which month is displayed
			selected: null // date selected by user
		},
		months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
		holidays: [
			{month: 0,	day: 1,		name: 'New Year\'s Day'},
			{month: 0,	day: 20,	name: 'Martin Luther King\'s Birthday'},
			{month: 1,	day: 17,	name: 'George Washington\'s Birthday'},
			{month: 4,	day: 26,	name: 'Memorial Day'},
			{month: 5,	day: 4,		name: 'Independence Day'},
			{month: 8,	day: 1,		name: 'Labor Day'},
			{month: 9,	day: 13,	name: 'Columbus Day'},
			{month: 10,	day: 11,	name: 'Veterans Day'},
			{month: 10,	day: 27,	name: 'Thanksgiving Day'},
			{month: 11,	day: 25,	name: 'Christmas Day'}
		],
		options: {
			allow_weekends: $datepicker.attr('data-allow-weekends'),
			allow_holidays: $datepicker.attr('data-allow-holidays')
		},
		// ====================================
		// Render the Days of Currently-Viewed Month
		buildDisplay: function(){
			// ------------------------------------
			// Check if selected date already exists from input form and set up so day can be hilited
			var selectedDay = 0;
			if(this.date.selected){
				var selectedMonth = this.date.selected.getUTCMonth(),
					currentMonth = this.date.current.getUTCMonth(),
					currentYear = this.date.current.getUTCFullYear(),
					todaysYear = this.date.today.getUTCFullYear(),
					holidaysThisMonth = _.filter(this.holidays, {'month': currentMonth}),
					isHoliday = 0;
				if(selectedMonth === currentMonth && !isHoliday){
					selectedDay = this.date.selected.getUTCDate();
				}
				// Check if day is holiday. This is if user manually typed a date that is a holiday
				holidaysThisMonth.map(function(v,k){
					if(selectedDay === v.day){
						isHoliday = 1;
						selectedDay = 0;
					}
				});
				// ------------------------------------
				// Check if year is in current year. This is if user manually entered a year that is not the current year.
				if(currentYear !== todaysYear || isHoliday){
					$readonly_field.val('');
					datepicker.date.selected = null;
				}
			}
		
			// ------------------------------------
			// Construct month day cells
			var monthFirstDay = new Date(datepicker.date.current.getUTCFullYear(), datepicker.date.current.getUTCMonth(), 1),
				monthLastDay = new Date(datepicker.date.current.getUTCFullYear(), datepicker.date.current.getUTCMonth() + 1, 0),
				daysInMonth = monthLastDay.getUTCDate(),
				emptyCellsFront = monthFirstDay.getUTCDay(),
				//emptyCellsEnd = Math.ceil(daysInMonth/7) - emptyCellsFront,
				emptyCellsEnd = 6 - monthLastDay.getUTCDay(),
				currentMonth = monthFirstDay.getUTCMonth(),
				HTMLString = '',
				dayCount = 0,
				holidaysThisMonth = _.filter(this.holidays, {'month': currentMonth}) // Create new object of only holidays of current month since unnecessary to check against all holiday. While not really gaining much, it simplifies that we only need to check against just the day
				;

			// ------------------------------------
			// Set up header
			$datepicker_month.html(datepicker.months[monthFirstDay.getUTCMonth()] + ' ' + datepicker.date.current.getUTCFullYear());
		
			// ------------------------------------
			// Get width of container
			var parentOuterWidth = $datepicker.parent().outerWidth();
		
			// ------------------------------------
			// Add days of week
			
			HTMLString += '' + 
				'<div class="day_of_week"><span class="desktop-tablet-only">Sun<span class="desktop-only">day</span></span><span class="mobile-only">S</span></div>' + 
				'<div class="day_of_week"><span class="desktop-tablet-only">Mon<span class="desktop-only">day</span></span><span class="mobile-only">M</span></div>' + 
				'<div class="day_of_week"><span class="desktop-tablet-only">Tue<span class="desktop-only">sday</span></span><span class="mobile-only">T</span></div>' + 
				'<div class="day_of_week"><span class="desktop-tablet-only">Wed<span class="desktop-only">nesday</span></span><span class="mobile-only">W</span></div>' + 
				'<div class="day_of_week"><span class="desktop-tablet-only">Thu<span class="desktop-only">rsday</span></span><span class="mobile-only">T</span></div>' + 
				'<div class="day_of_week"><span class="desktop-tablet-only">Fri<span class="desktop-only">day</span></span><span class="mobile-only">F</span></div>' + 
				'<div class="day_of_week"><span class="desktop-tablet-only">Sat<span class="desktop-only">urday</span></span><span class="mobile-only">S</span></div>'
		
			// ------------------------------------
			// Add empty cells in front
			for (var i = 0; i < emptyCellsFront; i++){
				dayCount++;
				if (i + 1 < emptyCellsFront) {
					HTMLString += '<div class="day day_empty"><div class="day_number"></div></div>';
				} else {
					HTMLString += '<div class="day day_empty" style="width:' + (parentOuterWidth * .134284) + 'px;margin-right:1%;"><div class="day_number"></div></div>';
				}
			}
			// ------------------------------------
			// Add day cells		
			for (var i = 0; i < daysInMonth; i++){
				dayCount++;
			
				// Check if this is a holiday
				var isHoliday = null,
					holidayName = '';

				holidaysThisMonth.map(function(v,k){
					if(v.day === i+1){
						isHoliday = 1;
						holidayName = v.name;
					}
				});
				
				if(isHoliday){
					if (datepicker.options.allow_holidays === 'no') {
						HTMLString += '<div class="day day_holiday"><div class="day_number">' + (i + 1) + '</div><div class="day_text_bottom">' + holidayName + '</div></div>';
					} else {
						HTMLString += '<div class="day day_active day_holiday"><div class="day_number">' + (i + 1) + '</div><div class="day_text_bottom">' + holidayName + '</div></div>';
					}
				} else {
					if(datepicker.options.allow_weekends === 'no' && (dayCount % 7 === 0 || dayCount % 7 === 1)){
						HTMLString += '<div class="day day_inactive"><div class="day_number">' + (i + 1) + '</div></div>';
					} else {
						
						if (this.date.current.getUTCMonth() === this.date.today.getUTCMonth() && this.date.current.getFullYear() === this.date.today.getFullYear() && this.date.today.getDate() === i + 1) {
							HTMLString += '<div class="day day_active day_today day' + (i + 1) + '"><div class="day_number">' + (i + 1) + '</div><div class="day_text_top">Today</div></div>';
						} else {
							HTMLString += '<div class="day day_active day' + (i + 1) + '"><div class="day_number">' + (i + 1) + '</div></div>';
						}
						//if(selectedDay === (i + 1)){
						//	HTMLString += '<div class="day day_active active"><div class="day_number">' + (i + 1) + '</div></div>';
						//} else {
						//}
					}
				}
			}
			// ------------------------------------
			// Add empty cells at end
			emptyCellsEnd += 42 - (emptyCellsFront + daysInMonth + emptyCellsEnd);
		
			for (var i = emptyCellsEnd; i > 0; i--){
				if ((i - 1) % 7 !== 0) {
					HTMLString += '<div class="day day_empty"><div class="day_number"></div></div>';
				} else {
					HTMLString += '<div class="day day_empty" style="width:' + (parentOuterWidth * .134284) + 'px;"><div class="day_number"></div></div>';
				}
			}
			HTMLString += '<br class="clear">';
						
			// ------------------------------------
			// Insert HTML to display
			$days.html(HTMLString);
		
			$('.day').map(function(v,k){
				$(k).css({
					'margin-bottom': parentOuterWidth * .01
				});
			});
		
			// ------------------------------------
			// If a date has already been selected, then hilite that day cell
			if(selectedDay){
				datepicker.selectDate($('.day' + selectedDay));
			}
		
			// ------------------------------------
			// Don't allow navigating to past months
			if (this.date.current.getUTCMonth() === this.date.today.getUTCMonth() && this.date.current.getFullYear() === this.date.today.getFullYear()) {
				$button_previous.addClass('inactive');
			} else {
				$button_previous.removeClass('inactive');
			}
		
			// ------------------------------------
			// Bindings
			var $day_active = $('.day_active'),
				$day_holiday = $('.day_holiday');
		
			$day_active
			.on('mouseenter', function(){})
			.on('mouseleave', function(){
				var $div = $(this);
				$div.removeClass('day_style_hover');
			})
			.on('click touchend', function(){
				datepicker.selectDate($(this));
				datepicker.saveSelection();
			});
		},
		// ====================================
		// Select Date
		selectDate: function($div){
			var $day_active = $('.day_active');

			// Position Selection Border and Style cell
			var posX = $div.position().left,
				posY = $div.position().top;
			var parentOuterWidth = $datepicker.parent().outerWidth();
			$day_active.removeClass('active');
			$div.addClass('active');
		
			// Set Selected Date
			var thisDay = Number($div.find('.day_number').text());
			datepicker.date.selected = new Date(datepicker.date.current.getUTCFullYear(), datepicker.date.current.getUTCMonth(), thisDay);
		
		},
		// ====================================
		// Save Date Data to Read-Only Field
		saveSelection: function(){
			if(datepicker.date.selected){
				var month = datepicker.date.selected.getUTCMonth() + 1,
					day = datepicker.date.selected.getUTCDate(),
					year = datepicker.date.selected.getUTCFullYear();
				$readonly_field.val(month + '/' + day + '/' + year);
			}
		}
	};

	// Initialize Date Picker
	datepicker.init();

	// Button Previous Month
	$button_previous.on('click touchend', function(e){
		e.preventDefault();
		if(!$(this).hasClass('inactive')){
			datepicker.date.current = new Date(datepicker.date.current.getUTCFullYear(), datepicker.date.current.getUTCMonth() - 1, 1);
			datepicker.buildDisplay();
		}
	});

	// Button Next Month
	$button_next.on('click touchend', function(e){
		e.preventDefault();
		if(!$(this).hasClass('inactive')){
			datepicker.date.current = new Date(datepicker.date.current.getUTCFullYear(), datepicker.date.current.getUTCMonth() + 1, 1);
			datepicker.buildDisplay();
		}
	});

	// Window Resize
	$(window).on('resize', function(){
		datepicker.init();
	});
}

													lg(`date picker {blue{loaded}}`);
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
/*

// Global
import './nav';
import './modal';
import './tooltip';
import './tab';
import './nav-search';
import './forms';

// Components
import './skrollr';
import './carousel';
import './autosuggest';
import './date-picker';
import './form-buttons';
import './form-custom';
import './video';
import './map';

													lg(`{orange{main loaded}}`);
*/
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

// ====================================
// Navigation Menus

import $ from 'jquery';
import _ from 'lodash';
import {lg} from './quick-log';

// ====================================
// Desktop Navigation

let $nav_menu = $('.nav_menu'),						// The hidden nav menus
	$nav_link = $('.nav-level-1 li');				// The nav buttons

let menu_state = 0,									// 0: hidden, 1: visible. This will let us know if any menu is visible.
	active_menu = '';								// The currently active menu

if ($nav_menu.length) {

	// Debounce functions to tweak interaction timing
	let debounce_show_menu = _.debounce(show_menu, 300),
		debounce_hide_menu = _.debounce(hide_menu, 150);

	// Show menu function
	function show_menu(){
		$nav_menu.hide();
		$(`.${active_menu}`).show();
		menu_state = 1;
														lg(`menu {blue{shown}}: {purple{${active_menu}}}`);
	}

	// Hide menu function
	function hide_menu(){
		if (menu_state === 1) {
			$nav_menu.hide();
			menu_state = 0;
														lg(`all menus {blue{hidden}}`);
		}
	}

	// Nav menu buttons
	$nav_link
	.on('mouseenter', function(){
		debounce_hide_menu.cancel();
		active_menu = $(this).attr('data-menu');
		if (menu_state === 0) {
			debounce_show_menu();
		} else if (menu_state === 1) {
			show_menu();
		}
	})
	.on('mouseleave', function(){
		debounce_show_menu.cancel();
		debounce_hide_menu();
	})

	// Nav menus
	$nav_menu
	.on('mouseenter', function(){
		debounce_hide_menu.cancel();
	})
	.on('mouseleave', function(){
		debounce_show_menu.cancel();
		debounce_hide_menu();
	})

	// ====================================
	// Mobile Navigation

	let $nav_menu_mobile = $('.nav_menu_mobile'),		// The hidden mobile nav menu
		$nav_mobile_link = $('.nav-mobile_menu');		// The mobile nav button

	$nav_mobile_link.on('click', function(e){
		e.preventDefault();
		$nav_menu_mobile.toggle();
		$(this).toggleClass('active');
	})
}

													lg(`nav {blue{loaded}}`);

// ====================================
// Quick and Dirty Debugging
//
// This is my quick way for printing things to the screen without having to open the inspector or 
// have the inspector take up screen real estate. It's basically a better unintrusive "alert" 
// meant for simple logging only.
//
// Text can be colored for easy scanning with the following colors:
//
// {red{ text }}
// {orange{ text }}
// {yellow{ text }}
// {green{ text }}
// {blue{ text }}
// {purple{ text }}
// {gray{ text }}

import $ from 'jquery';

let html_snippet = `<div id=lg style="
	background:rgba(0,0,0,.88);
	position:fixed;
	bottom:0;
	right:0;
	color:#ccc;
	padding:5px;
	font-family:Inconsolata, arial;
	font-size:.7em;
	z-index:9999;
	-webkit-font-smoothing:subpixel-antialiased;
	display:none;
	line-height:1.1em;
	border-top-left-radius: 5px;
	"><span style="color:#3bbb33;">> Hover over me to hide</span><br></div>`;

$('body').append(html_snippet);

$('#lg').on('mouseenter', function(){$(this).html('').css({'display': 'none'});});

function lg(x){
	let y = x
		//.replace(/^#/, '<span style="color:#7a7a7a;">#</span>')
		//.replace(/^\//g, '<span style="color:#7a7a7a;">/</span>')
		.replace(/\{blue\{/g, '<span style="color:#42bab7;">')
		.replace(/\{purple\{/g, '<span style="color:#d238ce;">')
		.replace(/\{orange\{/g, '<span style="color:#ff5f21;">')
		.replace(/\{gray\{/g, '<span style="color:#7a7a7a;">')
		.replace(/\{green\{/g, '<span style="color:#3bbb33;">')
		.replace(/\{red\{/g, '<span style="color:#dc0101;">')
		.replace(/\{yellow\{/g, '<span style="color:#e2e03c;">')
		.replace(/\}\}/g, '</span>')
		;
	$('#lg').css({'display': 'block'}).append(`<span style="color:#7a7a7a;"># </span>${y}<br>`);
}

function lgObj(o) {
	var out = '';
	for (var p in o) {
		out += p + ': ' + o[p] + '\n';
	}
	lg(out);
};

export {lg, lgObj}
													lg(`quick-log {blue{loaded}}`);

// ====================================
// skrollr

import $ from 'jquery';
import {lg} from './quick-log';
import s from 'skrollr';

if ($('.scroll-motion').length) {
	lg(`skrollr start`);
	s.init();
} else {
	lg(`skrollr no start`);
}
													lg(`skrollr {blue{loaded}}`);
// ====================================
// Convert Time to HH:MM:SS

import {lg} from './quick-log';

String.prototype.toHHMMSS = function () {
	let sec_num = parseInt(this, 10); // don't forget the second param
	let hours = Math.floor(sec_num / 3600);
	let minutes = Math.floor((sec_num - (hours * 3600)) / 60);
	let seconds = sec_num - (hours * 3600) - (minutes * 60);

	if (hours < 10) {
		hours = '0'+hours;
	}
	if (minutes < 10) {
		minutes = '0'+minutes;
	}
	if (seconds < 10) {
		seconds = '0'+seconds;
	}
	let time = '';
	if (hours > 0) {
		time += hours+':';
	}
	time += minutes+':'+seconds;
	return time;
}

													lg(`snippet-convert_time_to_HHMMSS {blue{loaded}}`);

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
// ====================================
// Tooltip

import $ from 'jquery';
import _ from 'lodash';
import {lg, lgObj} from './quick-log';

let $tooltip = $('.tooltip'),						// The tooltips to open/hide
	$tooltip_link = $('.tooltip-link'),				// What gets hovered on to open the tooltip
	$active_tooltip,								// Active tooltip
	$active_link;									// Active link to display tooltip

if ($tooltip.length) {
	// Show tooltip debounce
	let debounce_show_tooltip = _.debounce(show_tooltip, 200);

	// Show tooltip
	function show_tooltip(){

		// Get desired position of tooltip relative to link (We'll adjust if desired position falls outside of viewport.)
		let tooltip_position = $active_link.attr('data-tooltip-position');
	
		// Display tooltip but set opacity to 0 so we can set up positioning first
		$active_tooltip.css({'display': 'block', 'opacity': 0}).removeClass('tooltip-full');
	
		// Tooltip attributes
		let tooltip = {
			height: $active_tooltip.outerHeight(),
			width: $active_tooltip.outerWidth()
		}
	
		// Link attributes
		let link = {
			width: $active_link.outerWidth(),
			height: $active_link.outerHeight(),
			x: $active_link.offset().left,
			y: $active_link.offset().top
		}

		// Window and viewport bounds from window scroll position
		let window_width = $(window).width();
		let scrollPos = {
			top: $(window).scrollTop(),
			bottom: $(window).scrollTop() + $(window).height()
		};
		
		// Additional vars for calculating position
		let pointer_size = 10,
			pointer_position_from_top_for_left_and_right = 32,
			additional_distance = window_width > 640 ? 5 : 0;	// Additional gap between link and tooltip

		// Tooltip x/y positions
		link.top = {
			x: (link.x + (link.width / 2))  -  (tooltip.width / 2),
			y: (link.y - pointer_size - additional_distance) - (tooltip.height)
		};
		link.bottom = {
			x: (link.x + (link.width / 2))  -  (tooltip.width / 2),
			y: link.y + link.height + pointer_size + additional_distance
		};
		link.left = {
			x: (link.x - pointer_size - additional_distance)  -  (tooltip.width),
			y: link.y + (link.height / 2) - pointer_position_from_top_for_left_and_right
		};
		link.right = {
			x: link.x + link.width + pointer_size + additional_distance,
			y: link.y + (link.height / 2) - pointer_position_from_top_for_left_and_right
		};

		// Variables to store whether tooltip position will be inbounds or not. Initially set to 1 (yes).
		let is_in = {
			top: 1,
			bottom: 1,
			left: 1,
			right: 1,
			target_pos: ''						// The desired target position of the tooltip after calculating which are inbounds or not.
		}
	
		// Get Corner Coordinates which we'll use to check whether potential tooltip are inbounds or not
		// Checking all potential positions first to see which are inbounds makes it easier to accommodate fallback positions from the desired position
		let corners = {
			pos_top: {
				corner1: {
					x: link.top.x,
					y: link.top.y - scrollPos.top
				}, 
				corner2: {
					x: link.top.x + tooltip.width,
					y: link.top.y + tooltip.height - scrollPos.top
				}
			},
			pos_bottom: {
				corner1: {
					x: link.bottom.x,
					y: link.bottom.y - scrollPos.top
				}, 
				corner2: {
					x: link.bottom.x + tooltip.width,
					y: link.bottom.y + tooltip.height - scrollPos.top
				}
			},
			pos_left: {
				corner1: {
					x: link.left.x,
					y: link.left.y - scrollPos.top
				}, 
				corner2: {
					x: link.left.x + tooltip.width,
					y: link.left.y + tooltip.height - scrollPos.top
				}
			},
			pos_right: {
				corner1: {
					x: link.right.x,
					y: link.right.y - scrollPos.top
				}, 
				corner2: {
					x: link.right.x + tooltip.width,
					y: link.right.y + tooltip.height - scrollPos.top
				}
			},
		}
	
		// If any corner of a potential tooltip position falls out of bounds, mark it as out of bounds
		if (corners.pos_top.corner1.x < 0 || corners.pos_top.corner1.y < 0 || corners.pos_top.corner2.x < 0 || corners.pos_top.corner2.y < 0 || corners.pos_top.corner1.x > window_width || corners.pos_top.corner1.y > scrollPos.bottom || corners.pos_top.corner2.x > window_width || corners.pos_top.corner2.y > scrollPos.bottom) {
			is_in.top = 0;
		}
		if (corners.pos_bottom.corner1.x < 0 || corners.pos_bottom.corner1.y < 0 || corners.pos_bottom.corner2.x < 0 || corners.pos_bottom.corner2.y < 0 || corners.pos_bottom.corner1.x > window_width || corners.pos_bottom.corner1.y > scrollPos.bottom || corners.pos_bottom.corner2.x > window_width || corners.pos_bottom.corner2.y > scrollPos.bottom) {
			is_in.bottom = 0;
		}
		if (corners.pos_left.corner1.x < 0 || corners.pos_left.corner1.y < 0 || corners.pos_left.corner2.x < 0 || corners.pos_left.corner2.y < 0 || corners.pos_left.corner1.x > window_width || corners.pos_left.corner1.y > scrollPos.bottom || corners.pos_left.corner2.x > window_width || corners.pos_left.corner2.y > scrollPos.bottom) {
			is_in.left = 0;
		}
		if (corners.pos_right.corner1.x < 0 || corners.pos_right.corner1.y < 0 || corners.pos_right.corner2.x < 0 || corners.pos_right.corner2.y < 0 || corners.pos_right.corner1.x > window_width || corners.pos_right.corner1.y > scrollPos.bottom || corners.pos_right.corner2.x > window_width || corners.pos_right.corner2.y > scrollPos.bottom) {
			is_in.right = 0;
		}
	
		// Set the actual tooltip position based on which potential positions fell within bounds.
		// If none are inbounds, set the target position to none and we will make an additional accommodation.
		if (tooltip_position === 'top') {
			is_in.target_pos = 	
						is_in.top === 1 ? 'top' : 
						is_in.right === 1 ? 'right' : 
						is_in.left === 1 ? 'left' : 
						is_in.bottom === 1 ? 'bottom' :
						'none';
		} else if (tooltip_position === 'bottom') {
			is_in.target_pos = 	
						is_in.bottom === 1 ? 'bottom' :
						is_in.right === 1 ? 'right' : 
						is_in.left === 1 ? 'left' : 
						is_in.top === 1 ? 'top' : 
						'none';
		} else if (tooltip_position === 'left') {
			is_in.target_pos = 	
						is_in.left === 1 ? 'left' : 
						is_in.right === 1 ? 'right' : 
						is_in.top === 1 ? 'top' : 
						is_in.bottom === 1 ? 'bottom' :
						'none';
		} else if (tooltip_position === 'right') {
			is_in.target_pos = 	
						is_in.right === 1 ? 'right' : 
						is_in.left === 1 ? 'left' : 
						is_in.top === 1 ? 'top' : 
						is_in.bottom === 1 ? 'bottom' :
						'none';
		}
	
		// If all tooltips are out of bounds, check whether top or bottom are most inbounds and display that one.
		// We're only using top and bottom, because the most common reason no potential positions would fall in bounds would be on mobile in portrait mode.
		// If we find that mobile landscapes are important, we can add additional accommodations.
		if (is_in.target_pos === 'none') {
			let how_far_out = {
				top: 0,
				bottom: 0
			}
		
			// Calculate how far out tooltip positioned on top would be
			how_far_out.top += corners.pos_top.corner1.x < 0 ? corners.pos_top.corner1.x : 0;
			how_far_out.top -= corners.pos_top.corner1.x > window_width ? corners.pos_top.corner1.x : 0;
			how_far_out.top += corners.pos_top.corner1.y < 0 ? corners.pos_top.corner1.y : 0;
			how_far_out.top -= corners.pos_top.corner1.y > scrollPos.bottom ? corners.pos_top.corner1.y : 0;
		
			how_far_out.top += corners.pos_top.corner2.x < 0 ? corners.pos_top.corner2.x : 0;
			how_far_out.top -= corners.pos_top.corner2.x > window_width ? corners.pos_top.corner2.x : 0;
			how_far_out.top += corners.pos_top.corner2.y < 0 ? corners.pos_top.corner2.y : 0;
			how_far_out.top -= corners.pos_top.corner2.y > scrollPos.bottom ? corners.pos_top.corner2.y : 0;
		
			// Calculate how far out tooltip positioned on bottom would be
			how_far_out.bottom += corners.pos_bottom.corner1.x < 0 ? corners.pos_bottom.corner1.x : 0;
			how_far_out.bottom -= corners.pos_bottom.corner1.x > window_width ? corners.pos_bottom.corner1.x : 0;
			how_far_out.bottom += corners.pos_bottom.corner1.y < 0 ? corners.pos_bottom.corner1.y : 0;
			how_far_out.bottom -= corners.pos_bottom.corner1.y > scrollPos.bottom ? corners.pos_bottom.corner1.y : 0;
		
			how_far_out.bottom += corners.pos_bottom.corner2.x < 0 ? corners.pos_bottom.corner2.x : 0;
			how_far_out.bottom -= corners.pos_bottom.corner2.x > window_width ? corners.pos_bottom.corner2.x : 0;
			how_far_out.bottom += corners.pos_bottom.corner2.y < 0 ? corners.pos_bottom.corner2.y : 0;
			how_far_out.bottom -= corners.pos_bottom.corner2.y > scrollPos.bottom ? corners.pos_bottom.corner2.y : 0;
		
			// Set attributes regardless if it ends up on top or bottom
			addTooltipClass('tooltip-full');
			$active_tooltip.css({'left': (window_width / 2) - ($active_tooltip.outerWidth() / 2)});
		
			// Recalculate link.top.y position
			link.top.y = (link.y - pointer_size - additional_distance) - ($active_tooltip.outerHeight());
		
			// Compare whether top or bottom is more inbounds and show that one
			if (how_far_out.top >= how_far_out.bottom) {
				$active_tooltip.css({'top': link.top.y});
			} else {
				$active_tooltip.css({'top': link.bottom.y});
			}
		} else {
		// Else position tooltip in following priority of if it is inbounds
			if (is_in.target_pos === 'top') {
				$active_tooltip.css({'left': link.top.x, 'top': link.top.y});
				addTooltipClass('tooltip-top');
			} else if (is_in.target_pos === 'right') {
				$active_tooltip.css({'left': link.right.x, 'top': link.right.y});
				addTooltipClass('tooltip-right');
			} else if (is_in.target_pos === 'left') {
				$active_tooltip.css({'left': link.left.x, 'top': link.left.y});
				addTooltipClass('tooltip-left');
			} else if (is_in.target_pos === 'bottom') {
				$active_tooltip.css({'left': link.bottom.x, 'top': link.bottom.y});
				addTooltipClass('tooltip-bottom');
			}
		}
			
		// Now show the tooltip
		$active_tooltip.css({'opacity': 1});
	}

	function addTooltipClass(x) {
		$active_tooltip
			.removeClass('tooltip-top tooltip-bottom tooltip-left tooltip-right tooltip-full')
			.addClass(x);
	}

	// Hide tooltip
	function hide_tooltip($x){
		$x.hide();
	}

	// Show tooltip on hover
	$tooltip_link
	.on('mouseenter', function(){
		$active_tooltip = $('.' + $(this).attr('data-tooltip'));
		$active_link = $(this);
		debounce_show_tooltip();
	})
	.on('mouseleave', function(){
		debounce_show_tooltip.cancel();
		hide_tooltip($(`.${$(this).attr('data-tooltip')}`));
	})
	// TOUCH: Toggle
	.on('touchend', function(){
		$active_tooltip = $('.' + $(this).attr('data-tooltip'));
		$active_link = $(this);
	
		if ($active_tooltip.css('display') === 'block') {
			hide_tooltip($active_tooltip)
		} else {
			$tooltip.hide();
			show_tooltip();
		}
	});

	// TOUCH: Close
	$tooltip
	.on('touchend', function(){
		$(this).hide();
	});
}
													lg(`tooltip {blue{loaded}}`);
// ====================================
// Video
// The video object and video controls are referenced against each other by the video objects id and the video controls data-video attribute.
// This allows the code below to accommodate any number of videos on a page.

import $ from 'jquery';
import _ from 'lodash';
import {lg, lgObj} from './quick-log';
import './snippet-convert_time_to_HHMMSS';

let $video = $('video'),
	$video_controls = $('.video-controls'),
	$video_big_button = $('.video-big-button'),
	$play =  $('.video-controls').find('.play'),
	$seek =  $('.video-controls').find('.seek'),
	$mute =  $('.video-controls').find('.mute'),
	$volume =  $('.video-controls').find('.volume'),
	$fullscreen =  $('.video-controls').find('.fullscreen');

	let seek_drag_state = 0,							// 0: not dragging, 1: dragging. Check if cursor is dragging seek slider or not
		volume_drag_state = 0;							// 0: not dragging, 1: dragging. Check if cursor is dragging volume slider or not

if ($video.length) {
	
	// ====================================
	// Get referenced video from data-video attribute
	function getTargetVideoVanilla($x) {
		return document.getElementById($x.parent().attr('data-video'));
	}
	function getTargetVideoJQuery($x) {
		return $(`#${$x.parent().attr('data-video')}`);
	}

	// ====================================
	// Get referenced controls from video id
	function getTargetControls(obj, control) {
		let x = $(obj).attr('id');
		return $(`*[data-video='${x}']`).find(`.${control}`);
	}

	// ====================================
	// Get referenced big button from data-video attribute
	function getTargetButton($this) {
		let x = $this.parent().attr('data-video');
		return $(`*[data-video-button='${x}']`);
	}

	// ====================================
	// Play / Pause
	$play.on('click', function(){
		let $v = getTargetVideoVanilla($(this));		// Set target video
	
		if ($v.paused == true) {						// Set play/pause state
			$(this).removeClass('paused');				// Change play button to pause icon
			$v.play();									// Play video
			getTargetVideoJQuery($(this)).attr('data-video_state', 1);	// Set target video's video state
			getTargetButton($(this)).addClass('inactive');	// Hide big play button
														lg(`play video {orange{${$(this).parent().attr('data-video')}}}`);
		} else {
			$(this).addClass('paused');					// Change play button to play icon
			$v.pause();									// Pause video
			getTargetVideoJQuery($(this)).attr('data-video_state', 0);	// Set target video's video state
			getTargetButton($(this)).removeClass('inactive');	// Show big play button
														lg(`pause video {orange{${$(this).parent().attr('data-video')}}}`);
		}
	});

	// ====================================
	// Seek
	$seek
	.on('mousedown', function(){
		let $v = getTargetVideoVanilla($(this));
		$v.pause();										// Pause video while scrubbing slider
		seek_drag_state = 1;
	})
	.on('mouseup', function(){
		let $v = getTargetVideoVanilla($(this));		// Set target div
		if (parseInt(getTargetVideoJQuery($(this)).attr('data-video_state')) === 1) {
			$v.play();									// Play video if it was playing before
		}
		seek($(this), getTargetVideoVanilla($(this)));
		seek_drag_state = 0;
	})
	.on('mousemove', function(){
		seek($(this), getTargetVideoVanilla($(this)));
	});

	// ====================================
	// Seek Function
	function seek($this, $v){
		if(seek_drag_state === 1){
			// Update video
			let time = $v.duration * ($this.val() / 100);	// Calcuate time
			$v.currentTime = time;						// Set time
		
			// Update customer progress bar
			let $x = $this.parent().find('.seek-bar').find('.seek-progress'); // Set target div
			$x.css({'width': `${$this.val()}%`});		// Update width of progress bar div	
		}
	}

	// ====================================
	// Video Events
	$video
	.on('timeupdate', function(){
		// Only make updates if seek control is not being dragged
		if(seek_drag_state === 0){
			// Update seek slider
			let value = (100 / this.duration) * this.currentTime;	// Calculate slider value
			getTargetControls(this, 'seek').val(value);	// Update seek slider
		
			// Update customer progress bar
			let $x = getTargetControls(this, 'seek-bar').find('.seek-progress');
			$x.css({'width': `${getTargetControls(this, 'seek').val()}%`});
		
			getTargetControls(this, 'progress-text').html((this.currentTime).toString().toHHMMSS() + ' / ' + (this.duration).toString().toHHMMSS());
		}
	})
	.on('ended', function(){
		$(this).attr('data-video_state', 0);			// When video ends, set video variable state to paused
		getTargetControls(this, 'play').addClass('paused'); // Set play/pause button to paused
		
		// Check if video exists within a modal. If so, close the modal.
		//let $x = $(this).parent().parent();
		//if ($x.hasClass('modal-inner-margin')) {
		//	$x.trigger('click');
		//}
														lg(`video end {orange{${$(this).attr('id')}}}`);

	})
	.on('loadedmetadata', function(){
		getTargetControls(this, 'progress-text').html((this.currentTime).toString().toHHMMSS() + ' / ' + (this.duration).toString().toHHMMSS());
	});

	// ====================================
	// Big Play Button
	$video_big_button
	.on('mouseenter', function(){
		$(this).parent().find('.video-controls').addClass('active');
	})
	.on('mouseleave', function(){
		$(this).parent().find('.video-controls').removeClass('active');
	})
	.on('click', function(){
		$(this).parent().find('.video-controls').find('.play').trigger('click');	// Just trigger standard play button click because functionality is exactly the same
	});

	// ====================================
	// Video Controls Container
	$video_controls
	.on('mouseenter', function(){
		$video_controls.addClass('active');
	})
	.on('mouseleave', function(){
		$video_controls.removeClass('active');
	});

	// ====================================
	// Mute / Unmute
	$mute.on('click', function(){
		let $v = getTargetVideoVanilla($(this));		// Set target video
		let $x = $(this).parent().find('.volume-container');	// Set target volume controls

		if ($v.muted == false) {						// Set mute/unmute state
			$(this).addClass('muted');					// Change mute button icon to muted
			$v.muted = true;							// Mute video
			$x.addClass('inactive');					// Obscure volume controls while muted
			$x.find('.volume').attr('disabled', true);	// Disable volume controls while muted
														lg(`mute video {orange{${$(this).parent().attr('data-video')}}}`);
		} else {
			$(this).removeClass('muted');				// Change mute button icon to unmuted
			$v.muted = false;							// Unmute video
			$x.removeClass('inactive');					// Visually re-enable default volume control 
			$x.find('.volume').attr('disabled', false);	// Re-enable volume controls
														lg(`unmute video {orange{${$(this).parent().attr('data-video')}}}`);
		}
	});

	// ====================================
	// Fullscreen
	$fullscreen.on('click', function(){
		let $v = getTargetVideoVanilla($(this));		// Set target video

		if ($v.requestFullscreen) {
			$v.requestFullscreen();						// Set Fullscreen
		} else if ($v.mozRequestFullScreen) {
			$v.mozRequestFullScreen();					// for Firefox
		} else if ($v.webkitRequestFullscreen) {
			$v.webkitRequestFullscreen();				// for Chrome and Safari
		}
	});

	// ====================================
	// Volume
	$volume
	.on('mousedown', function(){
		volume_drag_state = 1;
	})
	.on('mouseup', function(){
		setVolume($(this));
		volume_drag_state = 0;
	})
	.on('mousemove', function(){
		setVolume($(this));
	});

	// ====================================
	// Volume Function
	function setVolume($this){
		if(volume_drag_state === 1){
			let $v = getTargetVideoVanilla($this.parent());	// Set target video
			let volume = $this.val() / 100;				// Calculate video volume
			$v.volume = volume;							// Set volume
		
			// Update customer progress bar
			let $x = $this.parent().find('.volume-bar').find('.volume-level');	// Set target div
			$x.css({'width': `${$this.val()}%`});		// Update width of volume level div
		}
	}

	// ========================================================================
	// Video as Background

	let $video_background = $('.video-background');

	$video_background.each(function(){
		resize_background_video($(this));
	});

	// Resize and Reposition Background Video
	function resize_background_video($this){
		let vid_height = $this.height(),				// Video height
			vid_width = $this.width(),					// Video width
			parent_height = $this.parent().height(),	// Video parent height
			parent_width = $this.parent().width();		// Video parent width
	
		let width_ratio = vid_width / parent_width,		// Calculate width and height ratios
			height_ratio = vid_height / parent_height;
	
		// Compare ratios of width and height to parent to determine whether video needs to be resized/positioned vertically or horizontally
		if (width_ratio > height_ratio) {
			$this.parent().css({'width': `${1 / height_ratio * 100}%`});
			$this.css({'width': '100%'});
			let vid_new_width = $this.width();
			$this.parent().css({'left': (parent_width / 2) - (vid_new_width / 2), 'top': 0});	// Set new video position to vertically center in parent
		} else {
			$this.parent().css({'width': '100%'});
			$this.css({'width': '100%'});
			let vid_new_height = $this.height();
			$this.parent().css({'top': (parent_height / 2) - (vid_new_height / 2), 'left': 0});	// Set new video position to vertically center in parent
		}
	}

	// Resize and reposition all - For window resize
	function resize_all_background_videos(){
		$video_background.each(function(){
			$(this).css({'width': '100%'});
			$(this).parent().css({'width': '100%'});
			resize_background_video($(this));
		});
	}

	// Resize and reposition all debounce
	let debounce_resize_all_background_videos = _.debounce(resize_all_background_videos, 100);

	// Resize and position background video if window is resized
	$(window).on('resize', function() {
		debounce_resize_all_background_videos();
	});
}

													lg(`video {blue{loaded}}`);
