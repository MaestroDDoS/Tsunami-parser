const util		  = require( 'util' );
const fs		  = require( 'fs' );

const fetch 	  = require( 'node-fetch' );
const html_parser = require( 'node-html-parser' );
const pLimit 	  = require( 'p-limit' );
const iconv		  = require( 'iconv-lite' );

const last_page_regex 	= /page=(\d+)/;
const deep_option_regex = /(-*)(.+)/;

const max_promises		= 5;
const main_page			= 'https://ivtextil.ru'

const limit_single_company = pLimit( max_promises );
const limit_subcategory	   = pLimit( max_promises * 100 );

const csv_company_header = [ 'title', 'address', 'site', 'phones', 'work_times', 'mails', 'shop_enable', 'type_trades', 'categories', 'logo' ];

let last_page			= 0;
let per_page			= 1;
let company_list		= [ csv_company_header.join( ';' ) ];
let categories_table	= [];


const custom_select_info_from_company =
{
	logo: ( info ) =>
	{
		return	info?.getAttribute?.( 'href' );
	}
}

function fetch_text( link )
{
	return	fetch( link ).then( ( responce ) => 
		{
			if( responce.status !== 200 )
			{
				return	console.log( `error status ${link}: ${responce.status}` );
			}

			return	responce.text();
		}
	)
	.catch( ( msg_error ) => 
		{
			console.log( `!~~~~~~~~> error ${link}: ${msg_error}` );
		}
	);
}

function parse_categories_from_select2( dom )
{
	let select = dom.querySelector( '#edit-category' );
	let last_deep = 0;

	select.childNodes.forEach( ( option ) =>
		{
			let [ all, subtitle, title ] = deep_option_regex.exec( option.text );
			let deep = subtitle.length;

			if( last_deep >= deep )
			{
				categories_table.push( '\n' );
			}
			else
			{
				deep = 1;
			}

			categories_table.push( ';'.repeat( deep ) + title );

			last_deep = subtitle.length;
		}
	);
}

function parse_single_company( link )
{
	return	fetch_text( link ).then( ( data ) =>
		{
			let dom = html_parser.parse( data );

			let info = 
			{
				title		: dom.querySelectorAll( '.breadcrumb .inline.last' ),
				address		: dom.querySelectorAll( '.field-name-field-physical-address .field-item.even' ),
				site		: dom.querySelectorAll( '.field-name-field-site a' ),
				phones		: dom.querySelectorAll( '.field-type-telephone .field-item' ),
				work_times	: dom.querySelectorAll( '.field-name-field-work-hours .field-item' ),
				mails		: dom.querySelectorAll( '.field-name-field-email a' ),
				shop_enable	: dom.querySelectorAll( '.field-name-field-internet-shop .field-item.even' ),
				type_trades	: dom.querySelectorAll( '.field-name-field-kinds-of-trade .field-item' ),
				logo		: dom.querySelectorAll( '.field-name-field-company-logo a' ),
				categories	: dom.querySelectorAll( '.views-company-categories-main a' ),
			}

			let block = [];

			while( true )
			{
				let line = [], idx = block.length;

				csv_company_header.forEach( ( key, i ) =>
					{
						let custom_select = custom_select_info_from_company[ key ];
						let element 	  = info[ key ][ idx ];

						line[ i ] = custom_select?.( element ) ?? element?.text;
					}
				);

				block.push( line = line.join( ';' ) );
				
				if( line.length <= csv_company_header.length )
				{
					break;
				}
			}

			let count = company_list.push( block.join( '\n' ) );

			if( !( count % 50 ) )
			{
				console.log( `~~~~~~~~~~~~~> parsing: ${( ( count / ( last_page * per_page ) ) * 100).toFixed( 2 )}%` );
			}
		}
	);
}

function request_company_list( idx = 0 )
{
	return	fetch_text( `https://ivtextil.ru/catalog?manufacturer=All&page=${idx}` ).then( ( data ) => 
		{
			let dom 		  = html_parser.parse( data );
			let company_hrefs = dom.querySelectorAll( "h3.views-title-company a" );

			if( !last_page )
			{
				let page_href = dom.querySelector( ".pager-last.odd.last a" );

				if( page_href )
				{
					last_page = ( parseInt( last_page_regex.exec( page_href.getAttribute( 'href' ) || '' )?.[ 1 ] ) || 0 );
					per_page  = company_hrefs.length;

					if( last_page )
					{
						parse_categories_from_select2( dom );

						let promises = [];

						for( let i = 0; i <= last_page; i++ )
						{
							promises.push( request_company_list( i ) ); 
						}

						return	Promise.allSettled( promises );
					}
				}
			}

			if( company_hrefs.length )
			{
				let promises = [];

				company_hrefs.forEach( ( element ) =>
					{
						let link = element.getAttribute( 'href' );

						if( link )
						{
							promises.push( limit_single_company( () => parse_single_company( link ) ) ); 	//limit for avoid 502;
						}
					}
				);

				return	Promise.allSettled( promises );
			}
		}
	);
}

/*
	start searching
*/

	console.log( `~~~~~~~~~~~~~> start parsing company list...` ); 

request_company_list()
.then( () => 
	{ 
		console.log( `~~~~~~~~~~~~~> finish parsing company list, total: ${company_list.length-1}` ); 

			fs.writeFileSync( 'company_list.csv'	, iconv.encode( company_list	.join( '\n' ), 'win1251' ) );			//convert to win1251
			fs.writeFileSync( 'categories_table.csv', iconv.encode( categories_table.join( '' ), 'win1251' ) );

		console.log( '~~~~~~~~~~~~~> all done!' );
	}
);


