use serde_json::Value;

pub fn value_to_bytes(value: &Value) -> Option<Vec<u8>> {
    value.as_array().map(|arr| {
        arr.iter()
            .filter_map(|v| v.as_u64().map(|n| n as u8))
            .collect::<Vec<u8>>()
    })
}
