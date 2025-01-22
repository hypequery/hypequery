
type ColumnType =
    | 'String'
    | 'Int32'
    | 'Int64'
    | 'Float64'
    | 'DateTime'
    | 'Date'
    | 'Array(String)'
    | 'Array(Int32)';


export interface IntrospectedSchema {
    [tableName: string]: { [columnName: string]: ColumnType }; // Add this line
    property_details: {
        id: 'String';
        type: 'String';
        bedrooms: 'String';
        bathrooms: 'String';
        year_built: 'String';
        has_garage: 'String';
        total_area_sqm: 'Float64';
    };
    uk_price_paid: {
        price: 'String';
        date: 'Date';
        postcode1: 'String';
        postcode2: 'String';
        type: 'String';
        is_new: 'String';
        duration: 'String';
        addr1: 'String';
        addr2: 'String';
        street: 'String';
        locality: 'String';
        town: 'String';
        district: 'String';
        county: 'String';
    };
}
