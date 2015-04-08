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