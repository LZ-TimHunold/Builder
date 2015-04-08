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