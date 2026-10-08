{{ "\n" -}}
{% for section, categories in sections.items() %}
{% for category, entries in categories.items() %}
{% for text, issues in entries.items() %}
{{ text }}

{% endfor %}
{% endfor %}
{% endfor %}
{% if not sections or not sections.values() | select | list %}
- No new user-visible changes.
{% endif %}
