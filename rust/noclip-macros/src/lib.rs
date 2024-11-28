use syn::Data;
use quote::quote;

#[proc_macro_derive(FromStructPerField, attributes(from))]
pub fn derive_from_struct_per_field(item: proc_macro::TokenStream) -> proc_macro::TokenStream {
    let input = syn::parse_macro_input!(item as syn::DeriveInput);

    let mut from_structs = Vec::new();
    for attr in &input.attrs {
        match &attr.meta {
            syn::Meta::List(meta_list) => {
                let tokens: proc_macro::TokenStream = meta_list.tokens.clone().into();
                from_structs.push(syn::parse_macro_input!(tokens as syn::Path));
            },
            _ => unimplemented!(),
        };
    }

    let struct_identifier = &input.ident;
    let mut impls = proc_macro2::TokenStream::new();

    match &input.data {
        Data::Struct(syn::DataStruct { fields, .. }) => {
            let mut field_assignments = proc_macro2::TokenStream::new();
            for field in fields {
                let identifier = field.ident.as_ref().unwrap();
                field_assignments.extend(quote!{
                    #identifier: value.#identifier.into(),
                });
            }

            for from_struct in from_structs {
                impls.extend(quote!{
                    impl From<#from_struct> for #struct_identifier {
                        fn from(value: #from_struct) -> #struct_identifier {
                            #struct_identifier {
                                #field_assignments
                            }
                        }
                    }
                });
            }
        },
        _ => unimplemented!(),
    }

    impls.into()
}

#[proc_macro_derive(FromEnumPerVariant, attributes(from))]
pub fn derive_from_enum(item: proc_macro::TokenStream) -> proc_macro::TokenStream {
    let input = syn::parse_macro_input!(item as syn::DeriveInput);

    let mut from_enums = Vec::new();
    for attr in &input.attrs {
        match &attr.meta {
            syn::Meta::List(meta_list) => {
                let tokens: proc_macro::TokenStream = meta_list.tokens.clone().into();
                from_enums.push(syn::parse_macro_input!(tokens as syn::Path));
            },
            _ => unimplemented!(),
        };
    }

    let enum_identifier = &input.ident;
    let mut impls = proc_macro2::TokenStream::new();

    match &input.data {
        Data::Enum(syn::DataEnum { variants, .. }) => {
            for from_enum in from_enums {
                let mut variant_patterns = proc_macro2::TokenStream::new();
                for variant in variants {
                    let identifier = &variant.ident;
                    variant_patterns.extend(quote!{
                        #from_enum::#identifier => #enum_identifier::#identifier,
                    });
                }

                impls.extend(quote!{
                    impl From<#from_enum> for #enum_identifier {
                        fn from(value: #from_enum) -> #enum_identifier {
                            match value {
                                #variant_patterns
                            }
                        }
                    }
                });
            }
        },
        _ => unimplemented!(),
    }

    impls.into()
}

#[proc_macro_attribute]
pub fn from(attr: proc_macro::TokenStream, _: proc_macro::TokenStream) -> proc_macro::TokenStream {
    attr
}
